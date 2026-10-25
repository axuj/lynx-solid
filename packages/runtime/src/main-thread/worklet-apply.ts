/**
 * Worklet / MainThreadRef ops for the Main Thread executor.
 *
 * Handles SET_WORKLET_EVENT (MT_SET_EVENT), SET_MT_REF, and INIT_MT_REF.
 * Ported verbatim from the equivalent module in vue-lynx
 * (https://github.com/Huxpro/vue-lynx, Apache-2.0) — the integration surface
 * with @lynx-js/react/worklet-runtime
 * (https://github.com/lynx-family/lynx-stack, Apache-2.0): all state lives in
 * globalThis.lynxWorkletImpl (installed by the runtime bundle, typed via the
 * reference in internal/globals.d.ts), we only bridge our flat ops onto its
 * APIs.
 */

import type { Element, WorkletRefImpl } from '@lynx-js/react/worklet-runtime/bindings'
import { elements } from './element-registry'

/**
 * wvid → element registry id, recorded at bind time (applySetMtRef) and
 * consulted at unbind time. Ref release is a precise wvid lookup — mirroring
 * ReactLynx's releaseWorkletRef → removeValueFromWorkletRefMap(id) — instead
 * of probing `instanceof Element` (worklet-runtime's Element is a module
 * export, not a global, and has no `matches` method).
 */
const mtRefOwners = new Map<number, number>()

/**
 * id → bound main-thread worklet events ({type, name}), recorded on
 * MT_SET_EVENT binds. RELEASE needs it to reach the engine-side listeners:
 * there is no reverse lookup from an element to its worklet bindings, and
 * without the teardown the engine registry keeps pinning the destroyed
 * element (same class as the BG-side REMOVE_EVENT fix).
 */
const workletEvents = new Map<number, Array<{ type: string, name: string }>>()

// ---------------------------------------------------------------------------
// Public API (called from ops-apply.ts switch cases)
// ---------------------------------------------------------------------------

/** Record a worklet-event bind (deduped per type+name). */
export function noteWorkletEvent(id: number, eventType: string, eventName: string): void {
  const list = workletEvents.get(id)
  if (!list) {
    workletEvents.set(id, [{ type: eventType, name: eventName }])
    return
  }
  if (!list.some(e => e.type === eventType && e.name === eventName))
    list.push({ type: eventType, name: eventName })
}

/** Drop the record when the binding is explicitly removed (payload-less frame). */
export function forgetWorkletEvent(id: number, eventType: string, eventName: string): void {
  const list = workletEvents.get(id)
  if (!list)
    return
  const i = list.findIndex(e => e.type === eventType && e.name === eventName)
  if (i !== -1)
    list.splice(i, 1)
  if (list.length === 0)
    workletEvents.delete(id)
}

/**
 * RELEASE teardown for [firstId, firstId + count): engine listener removal +
 * worklet-ref unbind. MUST run before the RELEASE loop drops elements[id] —
 * the listener teardown needs the element handle.
 */
export function releaseWorkletState(firstId: number, count: number): void {
  const end = firstId + count
  for (const [id, evs] of workletEvents) {
    if (id < firstId || id >= end)
      continue
    const el = elements[id]
    if (el) {
      // PAPI has no remove-listener call — an undefined handler removes it
      // (same convention as the REMOVE_EVENT op).
      for (const ev of evs)
        __AddEvent(el, ev.type, ev.name, undefined)
    }
    workletEvents.delete(id)
  }
  for (const [wvid, owner] of mtRefOwners) {
    if (owner < firstId || owner >= end)
      continue
    mtRefOwners.delete(wvid)
    delete globalThis.lynxWorkletImpl._refImpl._workletRefMap[wvid]
  }
}

/** SET_WORKLET_EVENT: bind a worklet event handler to a native element */
export function applySetWorkletEvent(
  id: number,
  eventType: string,
  eventName: string,
  ctx: Record<string, unknown>,
): void {
  const el = elements[id]
  if (el) {
    // No ctx transform here — the engine routes worklet events through the
    // official runWorklet, which binds nested worklets, resolves refs and
    // stamps _execId at fire time. A bind-time transform would seal
    // not-yet-registered refs inside bound copies (and poison workletCache),
    // failing permanently on prop/flush ordering. See worklet-missing.md.
    // Native Lynx requires _workletType on the value to route the event
    // to runWorklet() instead of publishEvent(). React sets this in
    // workletEvent.ts:53 — we stamp it here on the MT side.
    // (First-screen delay/hydrate lives in the official worklet-runtime
    // IIFE; this bridge must not pre-create `lynxWorkletImpl`, or the IIFE
    // skips its own init and the whole worklet runtime stays dead.)
    ctx._workletType = 'main-thread'
    __AddEvent(el, eventType, eventName, {
      type: 'worklet',
      value: ctx,
    })
  }
}

/** SET_MT_REF: bind a MainThreadRef to a native element via worklet-runtime */
export function applySetMtRef(id: number, wvid: number): void {
  const el = elements[id]
  if (!el)
    return
  // Official ReactLynx workletRef.ts does the same before queueing the
  // ref — without it the engine may keep the node layout-only (no LynxUI),
  // so later Element.invoke fails with "node N does not have a LynxUI".
  __SetAttribute(el, 'has-react-ref', true)
  const refImplObj = globalThis.lynxWorkletImpl._refImpl
  const refMap = refImplObj._workletRefMap
  if (!(wvid in refMap)) {
    refMap[wvid] = {
      current: null,
      _wvid: wvid,
    }
  }
  const handle: WorkletRefImpl<Element | null> = {
    _wvid: wvid,
    _initValue: null,
    _type: 'main-thread:ref',
  }
  refImplObj.updateWorkletRef(handle, el)
  mtRefOwners.set(wvid, id)
}

/** INIT_MT_REF: register a value-only MainThreadRef in the worklet ref map */
export function applyInitMtRef(wvid: number, initValue: unknown): void {
  const refMap = globalThis.lynxWorkletImpl._refImpl._workletRefMap
  if (!(wvid in refMap)) {
    refMap[wvid] = { current: initValue, _wvid: wvid }
  }
}

/**
 * SET_MT_REF with wvid = -1: drop the element binding of the given element.
 * Deletes the refMap key (official `removeValueFromWorkletRefMap`), not just
 * nulling `current` — a retained key pins the cell forever. Rebind recreates
 * it (`applySetMtRef`/`applyInitMtRef` both guard on presence).
 */
export function applyUnbindMtRef(id: number): void {
  for (const [wvid, owner] of mtRefOwners) {
    if (owner !== id)
      continue
    mtRefOwners.delete(wvid)
    delete globalThis.lynxWorkletImpl._refImpl._workletRefMap[wvid]
  }
}

/** Reset worklet state — for testing only. */
export function resetWorkletState(): void {
  mtRefOwners.clear()
  workletEvents.clear()
}
