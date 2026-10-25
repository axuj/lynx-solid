/**
 * lynx-template: the dom-runtime-shaped counterpart of the fork-compiled
 * skeletons (babel-plugin-jsx-lynx).
 *
 * The compiled module imports these helpers under the module name
 * `@lynx-solid/runtime/lynx-template`:
 *
 *   var _tmpl$ = registerTemplate(1, { anchors: [...], nodeCount: 6 })
 *   function App() {
 *     var _el$ = _tmpl$(),
 *         _el$2 = _el$.refs[0], ...
 *     insert(_el$3, x)                       // dynamic text
 *     effect(() => x() ? "a" : "b", (_v$, _p$) => className(_el$3, _v$, _p$))
 *     return _el$
 *   }
 *
 * The BG keeps NO shadow subtree for a template instance: it allocates only
 * a placeholder root and claims the id run [firstId, firstId + nodeCount)
 * (the MT's create(P,H,S) execution owns those ids). `refs` are plain
 * numbers (firstId + DFS offset) — dynamic bindings address elements by id,
 * never by walking a shadow tree.
 */

import { createRenderer } from '@solidjs/universal'

import { errorMessage, errorStack } from '../internal/error'
import { applyMainThreadKey, applyPlainAttr } from './attr-core'
import { parseEventKey, register } from './event-registry'
import { scheduleFlush } from './flush'
import { nodeOps } from './node-ops'
import { sink } from './ops-sink'
import { MARKER_ID_BASE, ShadowElement } from './shadow-element'
import { resetTemplateEvents, trackTemplateEvent } from './template-events'

export interface LynxTemplateMeta {
  /** DFS offsets of the elements referenced by dynamic bindings. */
  anchors: { offset: number }[]
  /** Total P.create calls in the MT createCode (id run length). */
  nodeCount: number
}

/**
 * A template instance: the placeholder root ShadowElement (mountable, id =
 * firstId; the MT's createCode builds the real element for that id) with the
 * anchor ids (firstId + anchors[i].offset) attached as `refs` — the compiled
 * `_el$.refs[i]` reads. Plain numbers: the BG keeps no shadow subtree.
 */
export type LynxTemplateInstance = ShadowElement & {
  refs: number[]
  /**
   * Static element wrappers by MT id. Pure id handles for insert/remove
   * addressing — deliberately NOT linked into any BG list (the old
   * append-every-touch duplicated one node per call site and let anchor
   * resolution stop at non-sibling statics). Only lazy markers + real
   * dynamics form the coherent per-parent chains resolveAnchor walks.
   */
  staticCache: Map<number, ShadowElement>
  /** BG-only slot markers by compiler slot index (one per trailing slot). */
  markerCache: Map<number, ShadowElement>
}

const templates = new Map<number, LynxTemplateMeta>()

/** Reset module state – for testing only. */
export function resetLynxTemplateState(): void {
  templates.clear()
  resetTemplateEvents()
}

/**
 * Register a compiled template at module load. Returns the instance
 * function the compiled code calls as `_tmpl$()` — each call allocates a
 * fresh id run and ships one INSTANTIATE frame.
 */
export function registerTemplate(
  id: number,
  meta: LynxTemplateMeta,
): () => LynxTemplateInstance {
  templates.set(id, meta)
  return () => instantiateTemplate(id)
}

function instantiateTemplate(id: number): LynxTemplateInstance {
  const entry = templates.get(id)
  if (!entry)
    throw new Error(`registerTemplate: unknown template ${id}`)
  const firstId = ShadowElement.nextId
  const root = new ShadowElement('view')
  root.templateRef = { id, diffs: [], firstId, nodeCount: entry.nodeCount }
  ShadowElement.nextId += entry.nodeCount - 1
  sink.instantiate(id, [], firstId)
  scheduleFlush()
  return Object.assign(root, {
    refs: entry.anchors.map(a => firstId + a.offset),
    staticCache: new Map<number, ShadowElement>(),
    markerCache: new Map<number, ShadowElement>(),
  }) as LynxTemplateInstance // as: Object.assign shape matches the instance type, unrepresentable otherwise
}

/**
 * The official universal renderer over nodeOps: insertExpression (with its
 * sentinel/multi semantics and reconcileArrays) runs verbatim, mutating the
 * ShadowElement tree and emitting op frames through the nodeOps hooks.
 */
const renderer = createRenderer(nodeOps)

/**
 * Id handle for a static (template) element id — anchors live on the MT,
 * the BG only needs an id-carrying object for the official insert calls.
 * Cached per instance: every call site addressing the same static element
 * shares one object, so dynamics routed through it land in a single coherent
 * parent list. Never linked into a list here (see LynxTemplateInstance).
 */
function staticNode(root: LynxTemplateInstance, id: number): ShadowElement {
  let node = root.staticCache.get(id)
  if (!node) {
    node = new ShadowElement('view', id)
    root.staticCache.set(id, node)
  }
  return node
}

/**
 * BG-only insertion marker for a trailing dynamic slot (compiled
 * `_$marker(root, parent, slot)`). Created on first touch — compiled insert
 * calls run in document order, so appending here keeps every marker behind
 * all previously-arrived content and resolveAnchor always lands on the
 * correct next sibling. Never crosses to the MT (no CREATE/INSERT op):
 * the negative id is only ever compared by object identity on the BG.
 */
export function marker(
  root: LynxTemplateInstance,
  parent: number | ShadowElement,
  slot: number,
): ShadowElement {
  let node = root.markerCache.get(slot)
  if (!node) {
    node = new ShadowElement('#marker', MARKER_ID_BASE - slot)
    root.markerCache.set(slot, node)
    const parentNode = typeof parent === 'number' ? staticNode(root, parent) : parent
    parentNode.appendChild(node)
  }
  return node
}

/**
 * dom-expressions' insert(container, accessor, marker?) — official
 * @solidjs/universal implementation, op semantics via nodeOps. `root` is the
 * template instance (kept for the compiled call shape), `parent`/`marker`
 * are ids (or ShadowElements); static anchors are wrapped lazily.
 */
export function insert(
  root: LynxTemplateInstance,
  parent: number | ShadowElement,
  accessor: unknown,
  marker?: number | ShadowElement | null,
): void {
  // Fail fast with full context: a raw "reading 'insertBefore' of undefined"
  // here gets converted to an error status (#2884) whose message never
  // reaches the console, and the error storm overflows the PrimJS stack on
  // device. refs[N] === undefined means the compiled call site references an
  // anchor slot the template metadata never allocated.
  const parentNode = typeof parent === 'number' ? staticNode(root, parent) : parent
  if (parentNode === undefined || parentNode === null) {
    throw new TypeError(
      `insert: parent is ${String(parent)} — template=${String(root?.templateRef?.id)}, refs=${root?.refs?.length}, firstId=${root?.templateRef?.firstId ?? '?'}, anchorSlot=${typeof marker === 'number' ? marker : '-'}`,
    )
  }
  const markerNode = marker == null
    ? undefined
    : typeof marker === 'number' ? staticNode(root, marker) : marker
  try {
    renderer.insert(parentNode, accessor, markerNode)
  }
  catch (e) {
    // Surface the raw error BEFORE Solid converts it to an error status
    // (#2884): the status path never prints the message and the resulting
    // notification storm overflows the PrimJS stack on device.
    const message = errorMessage(e)
    const stackSnippet = errorStack(e)
    console.error(
      '[LYNX-SOLID-INSERT-FAIL]',
      message,
      `\nnode=${JSON.stringify({ tpl: root?.templateRef, refsLen: root?.refs?.length })}`,
      `\nparent=${typeof parentNode === 'object' ? `${parentNode.type}#${parentNode.id}` : String(parentNode)}`,
      `\nmarker=${typeof markerNode === 'object' && markerNode ? `${markerNode.type}#${markerNode.id}` : String(markerNode)}`,
      stackSnippet,
    )
    throw e
  }
}

const toId = (el: number | ShadowElement): number => (typeof el === 'number' ? el : el.id)

/**
 * Solid's classList semantics (mirrors classListToObject in
 * @dom-expressions/runtime/src/client.js): a class value may be a string, an
 * object of `name: boolean` pairs or a nested array; truthy keys win, and
 * whitespace-separated keys split into individual class names.
 */
function classListToClassString(value: unknown): string {
  if (value == null)
    return ''
  if (typeof value === 'string')
    return value
  const parts: string[] = []
  const visit = (v: unknown): void => {
    if (v == null)
      return
    if (typeof v === 'string') {
      parts.push(v)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v)
        visit(item)
      return
    }
    if (typeof v === 'object') {
      for (const [key, on] of Object.entries(v)) {
        if (!on)
          continue
        for (const name of key.trim().split(/\s+/)) {
          if (name)
            parts.push(name)
        }
      }
    }
  }
  visit(value)
  return parts.join(' ')
}

/** dom-runtime className: value-diffed class binding. */
export function className(
  el: number | ShadowElement,
  value: unknown,
  prev?: unknown,
): void {
  if (value === prev)
    return
  const id = toId(el)
  sink.setClass(id, classListToClassString(value))
  scheduleFlush()
}

export function style(
  el: number | ShadowElement,
  value: unknown,
  prev?: unknown,
): void {
  if (value === prev)
    return
  const id = toId(el)
  if (!value) {
    sink.setStyle(id, '')
    scheduleFlush()
    return
  }
  if (typeof value === 'string') {
    sink.setStyle(id, value as string)
    scheduleFlush()
    return
  }
  // Full replacement: ship the whole normalized object, MT does __SetInlineStyles
  // (object form is a whole-style replace). Null-valued keys are dropped —
  // their absence implicitly removes them on the MT.
  const normalized: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (v != null)
      normalized[k] = String(v)
  }
  sink.setStyle(id, normalized)
  scheduleFlush()
}

/**
 * dom-runtime spread: apply each prop through the attribute pipeline
 * (class/style/event detection all ride setAttribute). Children and ref are
 * handled by their own compiled paths, so they are skipped here.
 */
export function spread(
  root: LynxTemplateInstance,
  props: Record<string, unknown>,
  _skipChildren?: boolean,
): void {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === 'children' || key === 'ref')
      continue
    setAttribute(root, root, key, value)
  }
}

/**
 * dom-runtime ref: Solid ref callback — invoked with the element's instance
 * id (the BG never holds the real element; the MT owns the tree).
 */
export function ref(fn: (el: unknown) => void, id: number): void {
  fn(id)
}

/** dom-runtime setAttribute: value-diffed attribute binding. */
export function setAttribute(root: LynxTemplateInstance, el: number | ShadowElement, key: string, value: unknown, prev?: unknown): void {
  if (value === prev)
    return
  const id = toId(el)
  // `main-thread:` namespace (ref / bind* worklet dispatch) — shared with
  // node-ops.setProperty (attr-core).
  if (applyMainThreadKey(id, key, value)) {
    scheduleFlush()
    return
  }
  // lynx event bindings (`bindtap`, `catchinput`, ...) go through
  // the event registry (sign + SET_EVENT), not SET_PROP.
  const event = parseEventKey(key)
  if (event && typeof value === 'function') {
    // as: cross-boundary — typeof function narrows to Function only; the
    // event callback's real signature is convention-defined by the event
    // system (same as the original register(value as …)).
    const sign = register(value as (data: unknown) => void)
    sink.setEvent(id, event.type, event.name, sign)
    // Template-internal ids have no shadow node — track so instance death
    // can ship REMOVE_EVENT + unregister (see template-events.ts).
    trackTemplateEvent(id, { type: event.type, name: event.name, sign })
    scheduleFlush()
    return
  }
  if (key === 'style')
    // Prev-aware per-key diffing stays local — node-ops ships a normalized
    // full replacement instead (see attr-core).
    style(el, value, prev)
  else
    // class/id/value/else — one implementation shared with node-ops.
    applyPlainAttr(id, key, value)
  scheduleFlush()
}

/** dom-runtime addEventListener: bind a handler by element id. */
export function addEventListener(
  el: number | ShadowElement,
  name: string,
  handler: (data: unknown) => void,
  eventType = 'bindEvent',
): void {
  const id = toId(el)
  const sign = register(handler)
  sink.setEvent(id, eventType, name, sign)
  trackTemplateEvent(id, { type: eventType, name, sign })
  scheduleFlush()
}

export { Page } from './page'
export { createComponent, createRenderEffect as effect, getOwner, createMemo as memo } from 'solid-js'

/**
 * Recursion depth the engine tolerates before RangeError. PrimJS ships a
 * much smaller stack than web JS runtimes — this number is the budget every
 * synchronous render/effect nesting level spends from.
 */
let cachedStackDepth: number | null = null
export function stackDepthSelfTest(): number {
  if (cachedStackDepth !== null)
    return cachedStackDepth
  let depth = 0
  const recurse = (): void => {
    depth++
    recurse()
  }
  try {
    recurse()
  }
  catch {
    cachedStackDepth = depth
  }
  return cachedStackDepth ?? 0
}
