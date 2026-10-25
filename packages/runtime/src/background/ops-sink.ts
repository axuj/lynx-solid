/**
 * The renderer's outbound seam: every op the renderer produces leaves through
 * one method here, instead of a bare `pushOp(...frame)`.
 *
 * Two deployments of the same emitters:
 *
 *   - {@link frameSink} (default, and the only sink the Background Thread ever
 *     uses): pack the frame into the flat ops buffer — the cross-thread
 *     protocol.
 *   - the direct sink (`main-thread/direct-sink.ts`, MT-IFR): apply the effect
 *     to PAPI right away, because on the Main Thread the ops are not a message
 *     from another thread — they are this renderer's own next step, and
 *     recording them only to walk the recording again pays for a frame
 *     pack/unpack and a second dispatch per effect.
 *
 * Methods are pure emission: flush scheduling stays at the call sites, exactly
 * as before the sink existed, so the frame sink is byte-identical to the
 * pre-sink code (the ops-protocol tests are the lock on that).
 */

import type { WorkletCtx } from './attr-core'
import { OP } from '../internal/ops'
import { push2, push3, push4, push5 } from './ops-buffer'

export interface OpsSink {
  create: (id: number, type: string) => void
  createText: (id: number) => void
  /** `anchorId = -1` means append. */
  insert: (parentId: number, childId: number, anchorId: number) => void
  remove: (parentId: number, childId: number) => void
  setProp: (id: number, key: string, value: unknown) => void
  setText: (id: number, text: string) => void
  setEvent: (id: number, eventType: string, eventName: string, sign: string) => void
  removeEvent: (id: number, eventType: string, eventName: string) => void
  /** `payload = null` removes the worklet binding. */
  setWorkletEvent: (id: number, eventType: string, eventName: string, payload: WorkletCtx | null) => void
  initMtRef: (wvid: number, initValue: unknown) => void
  /** `wvid = -1` unbinds. */
  setMtRef: (id: number, wvid: number) => void
  release: (firstId: number, count: number) => void
  setStyle: (id: number, value: unknown) => void
  setClass: (id: number, cls: string) => void
  setId: (id: number, idStr: string | null) => void
  instantiate: (templateId: number, diffs: unknown[], firstId: number) => void
}

/** Pack every op into the flat frame buffer — the Background Thread's sink. */
const frameImpl: OpsSink = {
  create: (id, type) => push3(OP.CREATE, id, type),
  createText: id => push2(OP.CREATE_TEXT, id),
  insert: (parentId, childId, anchorId) => push4(OP.INSERT, parentId, childId, anchorId),
  remove: (parentId, childId) => push3(OP.REMOVE, parentId, childId),
  setProp: (id, key, value) => push4(OP.SET_PROP, id, key, value),
  setText: (id, text) => push3(OP.SET_TEXT, id, text),
  setEvent: (id, eventType, eventName, sign) => push5(OP.SET_EVENT, id, eventType, eventName, sign),
  removeEvent: (id, eventType, eventName) => push4(OP.REMOVE_EVENT, id, eventType, eventName),
  setWorkletEvent: (id, eventType, eventName, payload) => push5(OP.MT_SET_EVENT, id, eventType, eventName, payload),
  initMtRef: (wvid, initValue) => push3(OP.INIT_MT_REF, wvid, initValue),
  setMtRef: (id, wvid) => push3(OP.SET_MT_REF, id, wvid),
  release: (firstId, count) => push3(OP.RELEASE, firstId, count),
  setStyle: (id, value) => push3(OP.SET_STYLE, id, value),
  setClass: (id, cls) => push3(OP.SET_CLASS, id, cls),
  setId: (id, idStr) => push3(OP.SET_ID, id, idStr),
  instantiate: (templateId, diffs, firstId) => push4(OP.INSTANTIATE, templateId, diffs, firstId),
}

export const frameSink: OpsSink = frameImpl

/**
 * The sink every emitter writes to. One stable object whose method slots are
 * swapped (`setOpsSink`) rather than a rebound module binding: emitters read
 * it per call, and a stable identity keeps that read free of live-binding
 * semantics in any bundler. The Background Thread never swaps it; only a Main
 * Thread IFR mount does, and it restores the frame sink afterwards.
 */
export const sink: OpsSink = { ...frameImpl }

export function setOpsSink(next: OpsSink): void {
  sink.create = next.create
  sink.createText = next.createText
  sink.insert = next.insert
  sink.remove = next.remove
  sink.setProp = next.setProp
  sink.setText = next.setText
  sink.setEvent = next.setEvent
  sink.removeEvent = next.removeEvent
  sink.setWorkletEvent = next.setWorkletEvent
  sink.initMtRef = next.initMtRef
  sink.setMtRef = next.setMtRef
  sink.release = next.release
  sink.setStyle = next.setStyle
  sink.setClass = next.setClass
  sink.setId = next.setId
  sink.instantiate = next.instantiate
}

/** Reset to the frame sink – for testing only. */
export function resetOpsSink(): void {
  setOpsSink(frameSink)
}
