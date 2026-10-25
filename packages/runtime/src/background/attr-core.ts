/**
 * Attribute semantics shared by the two BG dispatchers — the single place a
 * key class is implemented, so a new attribute semantic is written once:
 *
 *  - lynx-template.setAttribute — compiled dynamic bindings + spread
 *    (value-diffed, prev-aware, template-events teardown);
 *  - node-ops.setProperty — static template props + the universal renderer
 *    (sign-reusing events, elementEventSigns/holds teardown).
 *
 * Deliberately NOT shared (divergent by design, stays with each dispatcher):
 *  - event keys — teardown machinery differs (template-events vs
 *    elementEventSigns + batch-scoped holds) and only node-ops reuses the
 *    sign across re-renders;
 *  - `style` — lynx-template does prev-aware per-key diffing via the
 *    upstream style(), node-ops ships a normalized full replacement.
 */

import { assertCrossableValue } from '../internal/clone-safe'
import { parseEventKey } from './event-registry'
import { sink } from './ops-sink'
import { registerWorkletCtx } from './run-on-background'

/**
 * Worklet context produced by the official SWC transform
 * (`@lynx-js/react/transform`, JS target): `{ _wkltId, _c?, _jsFn? }`.
 * `_c` carries data snapshots, `_jsFn` carries `transformToWorklet` handles
 * for BG functions, shared imports resolve lexically on both threads.
 * Returns null when the value is not a worklet binding (the event is then
 * removed on the MT). `_c` values go through {@link assertCrossableValue} —
 * SWC does not validate, JSON would silently drop them.
 */
// must stay `type` (interfaces lack index signatures, this assigns to Record<string, unknown>)
/* eslint-disable-next-line ts/consistent-type-definitions */
export type WorkletCtx = {
  _wkltId: string
  _c?: Record<string, unknown>
  _jsFn?: Record<string, unknown>
}

function isWorkletCtx(value: unknown): value is WorkletCtx {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { _wkltId?: unknown })._wkltId === 'string'
  )
}

export function buildWorkletCtx(value: unknown): WorkletCtx | null {
  if (!isWorkletCtx(value))
    return null
  const _c = value._c ?? {}
  for (const [n, v] of Object.entries(_c))
    assertCrossableValue(n, v)
  return { _wkltId: value._wkltId, _c, ...(value._jsFn ? { _jsFn: value._jsFn } : {}) }
}

/**
 * Build AND register a worklet context for dispatch — registration stamps
 * the root `_execId` the MT-side `runOnBackground` dispatch echoes back
 * (official JsFnHandle model). Every MT_SET_EVENT producer must go through
 * this instead of bare `buildWorkletCtx`.
 */
export function buildRegisteredWorkletCtx(value: unknown): WorkletCtx | null {
  const ctx = buildWorkletCtx(value)
  if (ctx)
    registerWorkletCtx(ctx)
  return ctx
}

/**
 * Main Thread Script namespace: `main-thread:ref` binds a MainThreadRef to
 * the element (SET_MT_REF); `main-thread:bind*` ships the SWC worklet
 * context ({ _wkltId, _c?, _jsFn? }) — the handler body is registered on
 * the MT at compile time, the engine routes the event to it natively
 * (runWorklet); a non-worklet value removes the binding. Returns true when
 * the key belongs to the namespace and was handled (an unparseable
 * `main-thread:` key falls through like any unknown key).
 */
export function applyMainThreadKey(id: number, key: string, value: unknown): boolean {
  if (!key.startsWith('main-thread:'))
    return false
  const mtKey = key.slice('main-thread:'.length)
  if (mtKey === 'ref') {
    // The unbind frame is wvid = -1 — mt-script drops the binding.
    const wvid = (value as { _wvid?: number } | null | undefined)?._wvid // as: cross-boundary free var, shape unknown
    sink.setMtRef(id, wvid ?? -1)
    return true
  }
  const event = parseEventKey(mtKey)
  if (event) {
    sink.setWorkletEvent(id, event.type, event.name, buildRegisteredWorkletCtx(value))
    return true
  }
  return false
}

/**
 * Plain attribute semantics — class/id + the generic SET_PROP fall-through
 * (value included: the MT routes it to `default-value`/`setValue`, web
 * reflects it live). Pushes ops only; the caller owns scheduleFlush.
 */
export function applyPlainAttr(id: number, key: string, value: unknown): void {
  if (key === 'class') {
    sink.setClass(id, value == null ? '' : String(value))
  }
  else if (key === 'id') {
    // Official `__SetID` is `string | null`; normalize `undefined` → `null`
    // at the source so MT never sees `undefined`.
    sink.setId(id, value == null ? null : String(value))
  }
  else {
    sink.setProp(id, key, value)
  }
}
