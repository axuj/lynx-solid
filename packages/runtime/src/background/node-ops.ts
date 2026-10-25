/**
 * node-ops: implements Solid's universal RendererOptions on top of the
 * ShadowElement tree + the ops protocol. Solid believes it is rendering into
 * a normal tree; every operation mutates the shadow tree AND emits the
 * corresponding op frame for the Main Thread.
 */

import type { RendererOptions } from '@solidjs/universal'

import { applyMainThreadKey, applyPlainAttr } from './attr-core'
import {
  cancelTeardown,
  elementEventSigns,
  hasPendingTeardown,
  holdTeardown,
  resetTeardown,
} from './batch-teardown'
import { parseEventKey, register, unregister, updateHandler } from './event-registry'
import { scheduleFlush } from './flush'
import { sink } from './ops-sink'
import { DEFERRED_ID, isMaterialized, resolveAnchor, ShadowElement, walkSubtree } from './shadow-element'

/** Reset module state (event stores + pending teardown window) – for testing only. */
export function resetNodeOpsState(): void {
  resetTeardown()
}

/**
 * Every MT id owned by the subtree rooted at `node` (skeleton ranges expand
 * to their reserved run; plain materialized nodes their CREATE id). Shared
 * by removeNode (hold = about to die) and insertNode (cancel = re-claimed
 * by a same-batch keyed move); the walk is stateless, so it always answers
 * "what is alive right now".
 */
function collectDyingIds(node: ShadowElement): Set<number> {
  const dying = new Set<number>()
  walkSubtree(node, (n) => {
    if (n.templateRef) {
      const { firstId, nodeCount } = n.templateRef
      for (let i = 0; i < nodeCount; i++)
        dying.add(firstId + i)
    }
    else if (isMaterialized(n)) {
      dying.add(n.id)
    }
  })
  return dying
}

/**
 * DEV-only guard for native <list> children (mirrors ReactLynx
 * ElementTemplate `__DEV__` throws: `received a non-list-item root` /
 * `received text logical child`). The engine marks ANY appended child as a
 * list-item (`list_element.cc` — no native validation) and the MT
 * `insertListItem` path has no type check either, so without this the only
 * signal for `<list>{text}</list>` / `<list><view/></list>` is an async
 * 2202 item-key error with no node context. Production behavior is
 * unchanged (text stays off the MT, elements pass through as before) —
 * this only names the offender while developing.
 *
 * Empty text placeholders (Show/For off-state, the universal sentinel) are
 * framework bookkeeping, never violations — callers must only invoke this
 * for visible content. The message is printed BEFORE throwing: Solid
 * converts BG exceptions into an error status (#2884) whose message never
 * reaches the console (same reason lynx-template logs INSERT-FAIL first).
 */
function devThrowListChild(parent: ShadowElement, node: ShadowElement, kind: string): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const message = `[lynx-solid] <list>#${parent.id} received ${kind} #${node.id} as a direct child — only <list-item> is allowed (the child stays off the Main Thread in production)`
    console.error(message, `\nparent=${parent.type}#${parent.id}`, `\nnode=${node.type}#${node.id}`)
    throw new Error(message)
  }
}

/**
 * DEV-only guard: an op frame must never carry `DEFERRED_ID` as an element
 * id. `isMaterialized` is supposed to keep unmaterialized nodes off every
 * emit path; if a future change routes one through, the MT would resolve
 * `elements[0]` — the page root's neighbour — and silently corrupt the tree
 * instead of failing. Named here rather than left to the engine.
 */
function devAssertAllocated(node: ShadowElement, op: string): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__ && node.id === DEFERRED_ID) {
    throw new Error(
      `[lynx-solid] ${op} emitted for an unmaterialized ${node.type} node — `
      + `it has no MT id yet. This is a renderer invariant break (see DEFERRED_ID).`,
    )
  }
}

export const nodeOps: RendererOptions<ShadowElement> = {
  createElement(
    type: string,
    staticProps?: Record<string, unknown>,
  ): ShadowElement {
    // Lynx owns exactly one native page (__CreatePage in renderPage). Source
    // <page> is rewritten to the Page component; reaching here means a bypass
    // (uncompiled path) — engine rejects a second __CreateElement('page')
    // (990100). DEV names it; production still emits (same as vue-lynx).
    if (type === 'page' && typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error(
        '[lynx-solid] A <page> element reached the renderer as a plain element. '
        + 'It must be rewritten to the Page component (babel-plugin-jsx-lynx).',
      )
    }
    const el = new ShadowElement(type)
    sink.create(el.id, type)
    scheduleFlush()
    if (staticProps) {
      for (const [name, value] of Object.entries(staticProps))
        nodeOps.setProperty(el, name, value)
    }
    return el
  },

  createTextNode(value: string): ShadowElement {
    value = String(value)
    // Empty text owns no MT element until it holds visible text (mirrors
    // vue-lynx) — and therefore no op. Constructing it DEFERRED keeps
    // ShadowElement.nextId unmoved, so the counter tracks only ids that
    // actually cross to the MT. Without this the id sequence depends on how
    // many invisible placeholders a given render happened to allocate, which
    // differs between Solid's server and client builds (same count, different
    // positions) — see DEFERRED_ID.
    if (value === '') {
      const el = new ShadowElement('#text', DEFERRED_ID)
      return el
    }
    const el = new ShadowElement('#text')
    sink.createText(el.id)
    scheduleFlush()
    sink.setText(el.id, value)
    scheduleFlush()
    el.mtCreated = true
    return el
  },

  replaceText(textNode: ShadowElement, value: string): void {
    value = String(value)
    if (value === '') {
      // Emptied: drop the MT element when attached, keep the BG node as
      // the slot anchor (mtCreated stays — a later fill re-attaches
      // without re-creating, matching REMOVE's keep-the-mapping rule).
      if (textNode.mtInserted && textNode.parent) {
        sink.remove(textNode.parent.id, textNode.id)
        scheduleFlush()
        textNode.mtInserted = false
      }
      return
    }
    if (!textNode.mtCreated) {
      // First fill of a lazily created text node: this is where it becomes
      // real, so this is where it earns an id (see DEFERRED_ID).
      sink.createText(textNode.materializeId())
      scheduleFlush()
      textNode.mtCreated = true
    }
    sink.setText(textNode.id, value)
    scheduleFlush()
    // First fill after a BG-only stretch: attach at the BG-resolved
    // position. Native <list> takes only <list-item> children — visible
    // text never lands on its MT (DEV names the offender, mirroring
    // ReactLynx ElementTemplate; production silently keeps it off).
    const parent = textNode.parent
    if (parent && !textNode.mtInserted) {
      if (parent.type === 'list') {
        devThrowListChild(parent, textNode, 'text child')
      }
      else {
        const anchor = resolveAnchor(textNode.next)
        devAssertAllocated(textNode, 'INSERT')
        // Re-attach after a detach (if it went through removeNode earlier
        // this batch) re-claims the id — mirror insertNode's move cancel.
        cancelTeardown([textNode.id])
        sink.insert(parent.id, textNode.id, anchor ? anchor.id : -1)
        scheduleFlush()
        textNode.mtInserted = true
      }
    }
  },

  isTextNode(node: ShadowElement): boolean {
    return node.type === '#text'
  },

  setProperty(
    node: ShadowElement,
    name: string,
    value: unknown,
    _prev?: unknown,
  ): void {
    // `main-thread:` namespace (ref / bind* worklet dispatch) — shared with
    // lynx-template.setAttribute (attr-core).
    if (applyMainThreadKey(node.id, name, value)) {
      scheduleFlush()
      return
    }

    const event = parseEventKey(name)
    if (event) {
      const signs = elementEventSigns.get(node.id)
      const oldSign = signs?.get(name)

      if (typeof value === 'function') {
        if (oldSign) {
          // Re-render: same sign, freshest closure. MT binding untouched.
          updateHandler(oldSign, value as (data: unknown) => void) // as: Function (typeof-narrowed) → handler signature
        }
        else {
          // First binding of this event on this element.
          const sign = register(value as (data: unknown) => void) // as: Function (typeof-narrowed) → handler signature
          if (!signs) {
            const map = new Map<string, string>()
            map.set(name, sign)
            elementEventSigns.set(node.id, map)
          }
          else {
            signs.set(name, sign)
          }
          node.eventSigns ??= new Set()
          node.eventSigns.add(sign)
          sink.setEvent(node.id, event.type, event.name, sign)
          scheduleFlush()
        }
      }
      else if (oldSign) {
        // Handler removed entirely.
        unregister(oldSign)
        signs!.delete(name)
        node.eventSigns!.delete(oldSign)
        sink.removeEvent(node.id, event.type, event.name)
        scheduleFlush()
      }
      return
    }

    if (name === 'style') {
      // Full replacement: ship the whole normalized object via __SetInlineStyles.
      // `style` deliberately stays local — lynx-template does prev-aware
      // per-key diffing instead (see attr-core).
      if (!value) {
        sink.setStyle(node.id, '')
        scheduleFlush()
        return
      }
      if (typeof value === 'string') {
        sink.setStyle(node.id, value)
        scheduleFlush()
        return
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const normalized: Record<string, string> = {}
        for (const [k, v] of Object.entries(value)) {
          if (v != null)
            normalized[k] = String(v)
        }
        sink.setStyle(node.id, normalized)
        scheduleFlush()
        return
      }
      sink.setStyle(node.id, value)
      scheduleFlush()
      return
    }
    // class/id/value/else — one implementation shared with lynx-template.
    applyPlainAttr(node.id, name, value)
    scheduleFlush()
  },

  insertNode(
    parent: ShadowElement,
    node: ShadowElement,
    anchor?: ShadowElement,
  ): void {
    // Fail fast with full context: a raw "insertBefore of undefined" here
    // gets converted to a Solid error status (#2884) whose message never
    // reaches the console, and the resulting error storm overflows the
    // PrimJS stack on device. Name the offender instead.
    if (parent === undefined || parent === null) {
      throw new TypeError(
        `insertNode: parent is undefined — node=${node?.type}#${node?.id}, anchor=${anchor ? `${anchor.type}#${anchor.id}` : String(anchor)}`,
      )
    }
    if (node === undefined || node === null) {
      throw new TypeError(
        `insertNode: node is undefined — parent=${parent.type}#${parent.id}, anchor=${anchor ? `${anchor.type}#${anchor.id}` : String(anchor)}`,
      )
    }
    // Same-batch keyed MOVE: removeNode held this subtree's ids as dying;
    // re-inserting re-claims everything currently alive in it (stateless
    // re-walk cancels exactly the live set — children removed while the
    // subtree was detached stay held and ship at drain). One cancel clears
    // releases AND event teardowns (same window — batch-teardown.ts).
    // Skip the walk entirely when nothing is pending (pure insert).
    if (hasPendingTeardown()) {
      const live = collectDyingIds(node)
      cancelTeardown(live)
    }
    // Anchor ownership: ShadowElement.insertBefore splices blindly — an
    // anchor owned by a DIFFERENT parent would corrupt the shadow chain
    // silently, and the MT would then insert at a position the BG never
    // meant. BG owns the sibling chains, so assert here (O(1) via the
    // parent pointer) instead of tolerating it downstream: MT stays lenient
    // (unknown anchor ids append, matching vapor SLOT / ReactLynx), BG fails
    // fast.
    // Only anchors owned elsewhere throw: static id-carriers (lynx-template
    // staticNode — id-only stand-ins for MT-owned statics, never linked into
    // a BG chain, so parent === null) are legitimate anchors; the MT resolves
    // their position by id.
    if (anchor != null && anchor.parent != null && anchor.parent !== parent) {
      throw new TypeError(
        `insertNode: anchor ${anchor.type}#${anchor.id} is not a child of parent ${parent.type}#${parent.id} — node=${node.type}#${node.id}`,
      )
    }
    // Reparenting: detach from the previous parent on the Main Thread first
    // (BG-only nodes own no MT element, so there is nothing to detach).
    if (node.parent && node.parent !== parent && isMaterialized(node)) {
      sink.remove(node.parent.id, node.id)
      scheduleFlush()
    }
    parent.insertBefore(node, anchor ?? null)
    // BG-only anchors (slot markers) live in the shadow tree only — the MT
    // tree never sees them (mirrors vue-lynx `#comment`).
    if (!isMaterialized(node))
      return
    devAssertAllocated(node, 'INSERT')
    if (parent.type === 'list') {
      // Native <list> accepts only <list-item> children. Text reaching here
      // is always materialized (BG-only nodes returned above), i.e. visible
      // content — a DEV violation, not a placeholder. Empty-text anchors
      // (Show/For off-state) and BG-only slot markers never get here; they
      // stay silent framework bookkeeping, and the anchor for a list-item
      // insert resolves past them (they have no MT element).
      if (node.type === '#text') {
        devThrowListChild(parent, node, 'text child')
        return
      }
      if (node.type !== 'list-item') {
        // DEV names the offender (ReactLynx ElementTemplate parity);
        // production passes through unchanged.
        devThrowListChild(parent, node, `element <${node.type}>`)
      }
      let resolved = anchor ?? null
      while (resolved && (resolved.type === '#text' || !isMaterialized(resolved)))
        resolved = resolved.next
      sink.insert(parent.id, node.id, resolved ? resolved.id : -1)
      scheduleFlush()
      return
    }
    const resolved = resolveAnchor(anchor)
    sink.insert(parent.id, node.id, resolved ? resolved.id : -1)
    scheduleFlush()
    // Track text attachment for the lazy-materialization transitions in
    // replaceText (moves re-emit INSERT unconditionally, as before).
    if (node.type === '#text')
      node.mtInserted = true
  },

  removeNode(parent: ShadowElement, node: ShadowElement): void {
    parent.removeChild(node)
    // Detached text forgets its attachment (a later fill re-attaches without
    // re-creating). Collect every MT id that dies with this subtree —
    // skeleton instances release their whole reserved range (root id is the
    // range head), every other materialized node owns a CREATE entry — and
    // hold the set for the batch window: at drain both the event teardowns
    // and the RELEASE runs key off exactly these ids (pipeline spec:
    // batch-teardown.ts).
    const dying = new Set<number>()
    walkSubtree(node, (n) => {
      if (n.type === '#text')
        n.mtInserted = false
      if (n.templateRef) {
        const { firstId, nodeCount } = n.templateRef
        for (let i = 0; i < nodeCount; i++)
          dying.add(firstId + i)
      }
      else if (isMaterialized(n)) {
        dying.add(n.id)
      }
    })
    // Order is load-bearing: REMOVE detaches the subtree first; the drain
    // tail (REMOVE_EVENT then RELEASE) follows it — see batch-teardown.ts.
    if (isMaterialized(node)) {
      devAssertAllocated(node, 'REMOVE')
      sink.remove(parent.id, node.id)
      scheduleFlush()
    }
    holdTeardown(dying)
  },

  getParentNode(node: ShadowElement): ShadowElement | undefined {
    return node.parent ?? undefined
  },

  getFirstChild(node: ShadowElement): ShadowElement | undefined {
    return node.firstChild ?? undefined
  },

  getNextSibling(node: ShadowElement): ShadowElement | undefined {
    return node.next ?? undefined
  },
}
