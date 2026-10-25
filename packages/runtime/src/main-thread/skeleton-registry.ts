/**
 * Main Thread skeleton registry: the compiled create(P,H,S) functions land
 * here from the MT bundle (re-emitted by the build plugin from the BG
 * compiler's createCode). The BG never ships a serialized tree — per
 * instance it sends only INSTANTIATE [14, templateId, diffs, firstId]; this
 * module executes the skeleton locally and claims the id run
 * [firstId, firstId + nodeCount) with the P wrapper.
 */

import type { LynxElement } from '../internal/papi.d.ts'
import type { SkeletonCreateFn, SkeletonP } from '../internal/skeleton-types'
import { elements } from './element-registry'
import {
  isPlatformInfoAttr,
  setPlatformInfoProp,
} from './list-apply'
import { createElementByType } from './papi-adapt'

export type { SkeletonCreateFn, SkeletonP } from '../internal/skeleton-types'

const skeletons = new Map<number, SkeletonCreateFn>()

/**
 * Called once per template at MT bundle load, before any INSTANTIATE.
 *  Ids are content hashes (fnv1a of createCode) so BG/MT compilations
 *  derive them independently and always agree.
 */
export function registerSkeleton(
  id: number,
  create: SkeletonCreateFn,
): void {
  skeletons.set(id, create)
}

/** Whether a skeleton is registered (INSTANTIATE falls back otherwise). */
export function hasSkeleton(id: number): boolean {
  return skeletons.has(id)
}

/**
 * Per-instantiation state, kept at module scope and REUSED. Allocating this set
 * — a WeakMap plus the `claim` closure plus the eight-method `P` object — once
 * per template instance showed up in the main-thread profile: a 1000-row list
 * instantiates 1001 times. `instantiateSkeleton` saves and restores the state
 * around each call, so nested instantiations stay correct.
 */
let curFirstId = 0
let curCursor = 0
let curOnClaim: ((claimedId: number) => void) | undefined
/**
 * The P handlers receive `el` handles, but platform-info props (item-key…) are
 * keyed by bg id in list-apply. Entries are weak (they die with the elements)
 * and ids are never reused, so one WeakMap serves every instantiation.
 */
const curElementIds = new WeakMap<LynxElement, number>()

function claim(el: LynxElement): void {
  const elId = curFirstId + curCursor++
  if (elements[elId] !== undefined) {
    throw new Error(
      `id space collision: element ${elId} already exists — `
      + 'the BG and MT id spaces have drifted',
    )
  }
  elements[elId] = el
  curElementIds.set(el, elId)
  curOnClaim?.(elId)
}

const P: SkeletonP = {
  create(type) {
    // Lists must go through __CreateList with callbacks (createElementByType
    // dispatches list to createListElement); a plain __CreateElement('list')
    // leaves the native element without callbacks and the first item request
    // crashes the engine.
    const elId = curFirstId + curCursor
    const el = createElementByType(type, elId)
    if (type !== 'list')
      __SetCSSId([el], 0)
    claim(el)
    return el
  },
  rawText(content) {
    const el = __CreateRawText(content)
    __SetCSSId([el], 0)
    claim(el)
    return el
  },
  append(parent, child) {
    // Static-tree assembly only: the createCode DFS never mixes in dynamic
    // subtrees (those travel via $tpl reference children), and every
    // append targets a single sibling created moments ago.
    __AppendElement(parent, child)
  },
  cls(el, value) {
    if (value !== undefined && value !== null)
      __SetClasses(el, value as string)
  },
  style(el, value) {
    if (value !== undefined && value !== null)
      __SetInlineStyles(el, value as string | Record<string, unknown>)
  },
  id(el, value) {
    if (value === undefined)
      return
    __SetID(el, value === null ? null : String(value))
  },
  prop(el, key, value) {
    if (value !== undefined && value !== null) {
      // Platform-info attrs (item-key…) must reach list-apply's maps, not
      // __SetAttribute (native list-item elements reject them) — mirror
      // the dynamic SET_PROP routing in ops-apply.
      if (isPlatformInfoAttr(key)) {
        const id = curElementIds.get(el)
        if (id !== undefined)
          setPlatformInfoProp(id, key, value)
        return
      }
      __SetAttribute(el, key, value)
    }
  },
  event(el, name, sign, eventType = 'bindEvent') {
    if (sign === undefined || sign === null)
      return
    __AddEvent(el, eventType, name, sign)
  },
}

/** Execute a skeleton: DFS element creation with the id run owned by P. */
export function instantiateSkeleton(
  id: number,
  H: unknown[],
  firstId: number,
  onClaim?: (claimedId: number) => void,
): LynxElement {
  const create = skeletons.get(id)
  if (!create) {
    throw new Error(`instantiateSkeleton: unknown template ${id}`)
  }
  const prevFirstId = curFirstId
  const prevCursor = curCursor
  const prevOnClaim = curOnClaim
  curFirstId = firstId
  curCursor = 0
  curOnClaim = onClaim
  let out: LynxElement
  try {
    out = create(P, H, {})
  }
  finally {
    curFirstId = prevFirstId
    curCursor = prevCursor
    curOnClaim = prevOnClaim
  }
  return out
}

/** Reset module state – for testing only. */
export function resetSkeletonState(): void {
  skeletons.clear()
}
