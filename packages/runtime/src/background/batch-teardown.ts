/**
 * batch-teardown — THE batch window for destroy-path cleanup. This file is
 * the pipeline spec; call sites (node-ops, flush) stay thin.
 *
 * State machine
 * -------------
 *   BG removeNode  → holdTeardown(dying)
 *       dying = walkSubtree(node): shadow chains PLUS template roots'
 *       staticCache cells (unlinked id-carriers — see ShadowElement).
 *   BG insertNode  → cancelTeardown(live)      keyed MOVE re-claims in-tick
 *   replaceText    → cancelTeardown([textId])  lazy text re-attach
 *   drain (flush)  → flushBatchTeardown()      only when an executor exists
 *       (releasing into a dropped batch would lose the cleanup forever)
 *
 * Drain order — INVARIANT, checked by tests
 * ------------------------------------------
 *   REMOVE (mid-batch)  <  REMOVE_EVENT (drain tail, per held id:
 *       dynamic store first, then template store)  <  OP.RELEASE (sorted,
 *       contiguous runs)
 * The MT listener removal reads elements[id], so RELEASE must be last; all
 * three ride the same batch (flush pushes them before takeOps).
 *
 * One held-id set, three teardowns
 * --------------------------------
 * The held set IS the dying set — dynamic (elementEventSigns) and template
 * (template-events) bindings only ever exist on dying nodes, so their
 * teardowns are keyed off the same ids at flush time. One Set replaces what
 * used to be three parallel hold structures (release ids / node-event
 * records / template ids) with two cancel paths and two flush entries.
 *
 * Stores touched here: heldIds (this file) and elementEventSigns (moved
 * here because the flush path needs it — importing node-ops from flush
 * would cycle). template-events keeps its own store (takeTemplateEvents).
 */
import { parseEventKey, unregister } from './event-registry'
import { sink } from './ops-sink'
import { takeTemplateEvents } from './template-events'

/**
 * sign assigned per (element, propKey). Lets a re-render update the closure
 * in place (same sign, no MT round-trip) and unregister precisely when the
 * handler is removed.
 */
export const elementEventSigns = new Map<number, Map<string, string>>()

/** Ids dying at the next drain unless re-claimed — the single batch window. */
const heldIds = new Set<number>()

/** Queue ids for teardown at drain (REMOVE_EVENT + RELEASE for each). */
export function holdTeardown(ids: Iterable<number>): void {
  for (const id of ids)
    heldIds.add(id)
}

/** Re-claimed by a same-batch move — bindings AND mappings stay alive. */
export function cancelTeardown(ids: Iterable<number>): void {
  for (const id of ids)
    heldIds.delete(id)
}

/** True while anything waits — lets insertNode skip its re-walk. */
export function hasPendingTeardown(): boolean {
  return heldIds.size > 0
}

/**
 * Ship the batch tail for every held id: REMOVE_EVENT (dynamic store, then
 * template store) followed by the sorted, coalesced OP.RELEASE runs.
 */
export function flushBatchTeardown(): void {
  if (heldIds.size === 0)
    return
  const ids = [...heldIds].sort((a, b) => a - b)
  heldIds.clear()

  // 1) dynamic events — the store is read at flush (bindings added while
  // detached are caught too; a mid-batch handler removal already emitted
  // and deleted its entry, so it is skipped here).
  for (const id of ids) {
    const signs = elementEventSigns.get(id)
    if (!signs)
      continue
    for (const [propKey, sign] of signs) {
      const spec = parseEventKey(propKey)
      if (spec) {
        unregister(sign)
        sink.removeEvent(id, spec.type, spec.name)
      }
    }
    elementEventSigns.delete(id)
  }

  // 2) template-internal events (id-keyed store, same removal convention).
  for (const ev of takeTemplateEvents(ids)) {
    if (ev.sign)
      unregister(ev.sign)
    sink.removeEvent(ev.id, ev.type, ev.name)
  }

  // 3) releases — ids are already sorted; group contiguous runs.
  let start = ids[0]
  let prev = ids[0]
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] === prev + 1) {
      prev = ids[i]
      continue
    }
    sink.release(start, prev - start + 1)
    start = ids[i]
    prev = ids[i]
  }
  sink.release(start, prev - start + 1)
}

/** Reset window + stores – for testing only. */
export function resetTeardown(): void {
  heldIds.clear()
  elementEventSigns.clear()
}
