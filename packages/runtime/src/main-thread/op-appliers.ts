/**
 * Per-op appliers: the bodies of the Main Thread ops interpreter, extracted so
 * a second consumer can run them without a stream. `ops-apply.ts` walks a wire
 * batch and calls these; the MT-IFR direct sink (`direct-sink.ts`) calls the
 * very same functions as the renderer produces each op.
 *
 * One implementation, two callers: an effect can never mean two different
 * things depending on whether it arrived over the wire or was produced
 * locally. Everything here is PAPI + Main Thread bookkeeping — the ops
 * dictionary itself stays in internal/ops.ts.
 */

import { elements } from './element-registry'
import {
  insertListItem,
  isListParent,
  isPlatformInfoAttr,
  releaseListState,
  removeListItem,
  setPlatformInfoProp,
} from './list-apply'
import { createElementByType } from './papi-adapt'
import { hasSkeleton, instantiateSkeleton } from './skeleton-registry'
import {
  applySetWorkletEvent,
  forgetWorkletEvent,
  noteWorkletEvent,
  releaseWorkletState,
} from './worklet-apply'

/**
 * Dev tombstones: ids dropped by RELEASE this session. A later INSERT
 * targeting one means a cross-batch revive slipped past the batch-scoped
 * hold window (silent content loss) — warn instead of vanishing. Never
 * populated in prod bundles (`__DEV__` folded away).
 */
const releasedIds = new Set<number>()

/**
 * Ids created by the current apply pass. Pre-flush these nodes have no LynxUI
 * yet, so a `value` SET_PROP landing on them rides the engine's first-render
 * channel (`default-value`, consumed when the flush creates the UI);
 * everything else targets an element flushed in an earlier pass and takes the
 * synchronous `setValue` UI method. Same-pass ⇔ pre-flush because every pass
 * flushes before the next one applies.
 */
export type FreshIds = Set<number>

export function applyCreate(id: number, type: string, fresh: FreshIds): void {
  const el = createElementByType(type, id)
  if (type !== 'list')
    __SetCSSId([el], 0)
  elements[id] = el
  fresh.add(id)
}

export function applyCreateText(id: number, fresh: FreshIds): void {
  // Raw text run — inherits parent text styles; a nested <text> element
  // would drop font-size/style/weight on device.
  const el = __CreateRawText('')
  __SetCSSId([el], 0)
  elements[id] = el
  fresh.add(id)
}

export function applyInsert(parentId: number, childId: number, anchorId: number): void {
  const parent = elements[parentId]
  const child = elements[childId]
  if (parent && child) {
    if (isListParent(parentId)) {
      insertListItem(parentId, child, childId, anchorId)
    }
    else if (anchorId === -1) {
      __AppendElement(parent, child)
    }
    else {
      const anchor = elements[anchorId]
      if (anchor) {
        __InsertElementBefore(parent, child, anchor)
      }
      else {
        // Unknown anchor id (stale BG reference, replayed batch): fall back
        // to append so content survives instead of being silently dropped —
        // matches vue-lynx vapor INSERT_TEMPLATE_SLOT and ReactLynx snapshot
        // patching, which both append on unresolvable anchors (octane
        // throws).
        __AppendElement(parent, child)
      }
    }
  }
  else if (releasedIds.has(childId)) {
    // Cross-batch revive: the node was removed in an earlier batch (its
    // RELEASE already shipped — batch-scoped holds cannot cancel across
    // drains) and is now re-INSERTed without a fresh CREATE. The frame
    // degrades to this warning instead of a silent content drop.
    console.warn(`[lynx-solid] INSERT targets released id ${childId} (parent ${parentId}) — cross-batch revive missed the hold window; content dropped`)
  }
}

export function applyRemove(parentId: number, childId: number): void {
  const parent = elements[parentId]
  const child = elements[childId]
  if (!parent || !child)
    return
  if (isListParent(parentId)) {
    // Keep listItems / update-list-info in sync — otherwise Reset re-inserts
    // the same item-keys and native list errors. list-item lives in the
    // dataSource array, not the native tree — removal is driven by
    // update-list-info's removeAction.
    removeListItem(parentId, childId)
    return
  }
  // Keep the id mapping: a REMOVE only detaches the node, the element stays
  // addressable for later INSERT (keyed-list updates REMOVE a run then
  // INSERT the survivors back).
  __RemoveElement(parent, child)
}

export function applySetProp(id: number, key: string, value: unknown, fresh: FreshIds): void {
  if (isPlatformInfoAttr(key)) {
    // List-item platform info goes into update-list-info actions only, never
    // __SetAttribute (native list-item elements reject them).
    setPlatformInfoProp(id, key, value)
    return
  }
  const el = elements[id]
  if (!el)
    return
  if (key === 'value') {
    // Controlled `value`, two channels keyed by pass membership (fresh ⇔
    // pre-flush — see FreshIds):
    //  - fresh node: `default-value`, the engine's official first-render prop
    //    (types: "Only applies on the first render and does not trigger
    //    bindinput"), consumed when the flush creates the LynxUI — no invoke,
    //    no event.
    //  - node from an earlier batch: synchronous `setValue` UI method — the
    //    only post-mount channel (the engine exposes no `value` setter on any
    //    platform; same contract @lynx-js/lynx-ui implements via useEffect).
    // Pre-flush invoke would be dropped with code=6 ("node … does not have a
    // LynxUI"), which is why fresh never invokes.
    const str = value == null ? '' : String(value)
    if (fresh.has(id)) {
      __SetAttribute(el, 'default-value', str)
    }
    else if (typeof __InvokeUIMethod === 'function') {
      try {
        __InvokeUIMethod(el, 'setValue', { value: str }, (): void => {})
      }
      catch {
        // PAPI absent mid-flight (host shims) — no-op.
      }
    }
  }
  // Inline styles ride the dedicated PAPI; a raw `style` attribute is not a
  // native element channel (the official runtimes always call
  // __SetInlineStyles for style).
  if (key === 'style')
    __SetInlineStyles(el, value as string | Record<string, unknown>)
  else
    __SetAttribute(el, key, value)
}

export function applySetText(id: number, text: string): void {
  const el = elements[id]
  // Lynx stores a text element's payload in the "text" attribute.
  if (el)
    __SetAttribute(el, 'text', text)
}

export function applySetEvent(
  id: number,
  eventType: string,
  eventName: string,
  sign: string,
): void {
  const el = elements[id]
  if (el)
    __AddEvent(el, eventType, eventName, sign)
}

export function applyRemoveEvent(
  id: number,
  eventType: string,
  eventName: string,
): void {
  const el = elements[id]
  // PAPI has no remove-listener call — an undefined handler removes it.
  if (el)
    __AddEvent(el, eventType, eventName, undefined)
}

export function applyWorkletEvent(
  id: number,
  eventType: string,
  eventName: string,
  payload: Record<string, unknown> | null,
): void {
  if (payload) {
    applySetWorkletEvent(id, eventType, eventName, payload)
    noteWorkletEvent(id, eventType, eventName)
    return
  }
  // Removal — re-add with undefined handler on the element slot.
  applySetWorkletEvent(id, eventType, eventName, { __removed: true })
  const el = elements[id]
  if (el)
    __AddEvent(el, eventType, eventName, undefined)
  forgetWorkletEvent(id, eventType, eventName)
}

export function applySetStyle(
  id: number,
  value: unknown,
): void {
  const el = elements[id]
  if (!el)
    return
  if (value != null)
    __SetInlineStyles(el, value as string | Record<string, unknown>)
  else
    __SetInlineStyles(el, '')
}

export function applySetClass(id: number, cls: string): void {
  const el = elements[id]
  if (el)
    __SetClasses(el, cls)
}

export function applySetId(id: number, idStr: string | null): void {
  const el = elements[id]
  if (el)
    __SetID(el, idStr)
}

export function applyInstantiate(
  templateId: number,
  diffs: unknown[],
  firstId: number,
  fresh: FreshIds,
): void {
  if (!hasSkeleton(templateId))
    throw new Error(`INSTANTIATE: unknown template ${templateId}`)
  instantiateSkeleton(templateId, diffs, firstId, id => fresh.add(id))
}

/**
 * Destroy-path release: drop the id→element mappings so long sessions don't
 * accumulate one registry entry per row ever created. REMOVE keeps its mapping
 * on purpose (keyed revive contract); a stale INSERT after RELEASE degrades to
 * the unknown-id skip in applyInsert, never a crash (and warns in dev via the
 * releasedIds tombstone).
 *
 * Release completeness: the other id-keyed MT state rides the same frame —
 * engine worklet listeners + ref map (needs elements alive, hence first) and
 * the list tables keyed by these ids.
 */
export function applyRelease(firstId: number, count: number): void {
  releaseWorkletState(firstId, count)
  releaseListState(firstId, count)
  for (let i = 0; i < count; i++) {
    delete elements[firstId + i]
    if (typeof __DEV__ !== 'undefined' && __DEV__)
      releasedIds.add(firstId + i)
  }
}

/** Reset module state – for testing only. */
export function resetOpAppliers(): void {
  releasedIds.clear()
}
