/**
 * Direct ops sink — MT-IFR first screen.
 *
 * The Main Thread's IFR mount runs the *same* Solid renderer the Background
 * Thread runs, so the ops it produces are not a message from another thread:
 * they are this renderer's own next step. Recording them and walking the
 * recording afterwards pays a frame pack/unpack plus a second dispatch for
 * every effect. This sink does the effect instead, through the very same
 * appliers the interpreter uses (`op-appliers.ts`) — one pass, one meaning.
 *
 * Frames are still pushed to the ops buffer, on purpose: that recording is what
 * `ifr.ts` reconciles the Background's first batch against, and it is the only
 * record of *what* the Main Thread painted (structure + dynamic values, which
 * is exactly the frame stream). Dropping it is not free — measured, a
 * first-screen render with no recording makes every reconcile a structural
 * `diverge`, i.e. a teardown plus a full replay of the Background's batch on
 * the Main Thread, seconds of visible frozen screen. What the recording must
 * not* cost is the packing: the pushers append positionally (see
 * `background/ops-buffer.ts`), so a frame is one `Array#push`.
 *
 * No per-op try/catch on purpose: `runIfrMount` already wraps the mount, so a
 * failing op aborts the IFR attempt and the Background render takes over —
 * the same fallback the interpreter's isolation exists to avoid needing.
 */

import type { OpsSink } from '../background/ops-sink'
import type { FreshIds } from './op-appliers'
import { frameSink } from '../background/ops-sink'
import {
  applyCreate,
  applyCreateText,
  applyInsert,
  applyInstantiate,
  applyRelease,
  applyRemove,
  applyRemoveEvent,
  applySetClass,
  applySetEvent,
  applySetId,
  applySetProp,
  applySetStyle,
  applySetText,
  applyWorkletEvent,

} from './op-appliers'
import { applyInitMtRef, applySetMtRef, applyUnbindMtRef } from './worklet-apply'

/**
 * Ids created during the current mount — the pre-flush window of the direct
 * pass (see FreshIds; the flush happens after the whole render).
 */
const fresh: FreshIds = new Set<number>()

/** Arm a mount: the previous pass's ids are flushed by now. */
export function resetDirectSink(): void {
  fresh.clear()
}

/**
 * Ids the direct pass created (read by the IFR teardown). The set is the
 * appliers' own record — unlike the frame stream, it cannot confuse a
 * parent/template argument for a created id.
 */
export function getDirectSinkFreshIds(): ReadonlySet<number> {
  return fresh
}

export const directSink: OpsSink = {
  create(id, type) {
    frameSink.create(id, type)
    applyCreate(id, type, fresh)
  },
  createText(id) {
    frameSink.createText(id)
    applyCreateText(id, fresh)
  },
  insert(parentId, childId, anchorId) {
    frameSink.insert(parentId, childId, anchorId)
    applyInsert(parentId, childId, anchorId)
  },
  remove(parentId, childId) {
    frameSink.remove(parentId, childId)
    applyRemove(parentId, childId)
  },
  setProp(id, key, value) {
    frameSink.setProp(id, key, value)
    applySetProp(id, key, value, fresh)
  },
  setText(id, text) {
    frameSink.setText(id, text)
    applySetText(id, text)
  },
  setEvent(id, eventType, eventName, sign) {
    frameSink.setEvent(id, eventType, eventName, sign)
    applySetEvent(id, eventType, eventName, sign)
  },
  removeEvent(id, eventType, eventName) {
    frameSink.removeEvent(id, eventType, eventName)
    applyRemoveEvent(id, eventType, eventName)
  },
  setWorkletEvent(id, eventType, eventName, payload) {
    frameSink.setWorkletEvent(id, eventType, eventName, payload)
    applyWorkletEvent(id, eventType, eventName, payload)
  },
  initMtRef(wvid, initValue) {
    frameSink.initMtRef(wvid, initValue)
    applyInitMtRef(wvid, initValue)
  },
  setMtRef(id, wvid) {
    frameSink.setMtRef(id, wvid)
    if (wvid >= 0)
      applySetMtRef(id, wvid)
    else applyUnbindMtRef(id)
  },
  release(firstId, count) {
    frameSink.release(firstId, count)
    applyRelease(firstId, count)
  },
  setStyle(id, value) {
    frameSink.setStyle(id, value)
    applySetStyle(id, value)
  },
  setClass(id, cls) {
    frameSink.setClass(id, cls)
    applySetClass(id, cls)
  },
  setId(id, idStr) {
    frameSink.setId(id, idStr)
    applySetId(id, idStr)
  },
  instantiate(templateId, diffs, firstId) {
    frameSink.instantiate(templateId, diffs, firstId)
    applyInstantiate(templateId, diffs, firstId, fresh)
  },
}
