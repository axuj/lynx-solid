/**
 * Crossing-time guard for values crossing the BG↔MT boundary, mirroring
 * octane's `cloneValue` (`core/worklets.ts`): fail loud with the value path
 * instead of dying silently on the far side. Neither vue-lynx nor lynx-stack
 * validates — this is a deliberate, documented deviation for debuggability:
 * a bare function becomes `undefined` after JSON with zero errors far-side,
 * and only the sender knows the variable name.
 *
 * Applies at every JSON-serialized crossing this runtime owns: worklet
 * `_c` captures (via `buildWorkletCtx`), cross-thread call params and
 * return values (both directions). MT return values dispatched by the
 * official worklet-runtime IIFE are out of scope (not our code).
 *
 * Passes: primitives (finite numbers), plain objects/arrays (recursed),
 * worklet descriptors (`_wkltId`/`_jsFnId`/`_wvid`, including class
 * instances like MainThreadRef which cross via `toJSON`) and
 * `elementRefptr` envelopes. The `_c` of a descriptor is recursed into;
 * anything else on it is an id field and passes untouched.
 */
export function assertCrossableValue(label: string, value: unknown, seen: Set<object> = new Set()): void {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean')
    return
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      failCrossing(label, 'is not a finite number and becomes null after JSON serialization. Pass a finite number.')
    return
  }
  if (typeof value === 'function') {
    failCrossing(label, 'is a function and will be dropped by JSON serialization (the far side calls undefined). Mark it with the \'main thread\' directive, move it into a `with { runtime: \'shared\' }` module, or call it via runOnBackground.')
    return
  }
  if (typeof value === 'symbol' || typeof value === 'bigint') {
    failCrossing(label, `is a ${typeof value} and cannot cross the thread boundary by JSON.`)
    return
  }
  if (seen.has(value))
    failCrossing(label, 'contains a circular reference and cannot be JSON serialized.')
  seen.add(value)
  try {
    const rec = value as Record<string, unknown> // as: cross-thread data, object→indexable Record (guarded object above)
    const markers = (('_wkltId' in rec) ? 1 : 0) + (('_jsFnId' in rec) ? 1 : 0) + (('_wvid' in rec) ? 1 : 0) + (('elementRefptr' in rec) ? 1 : 0)
    if (markers > 1)
      failCrossing(label, 'mixes reserved worklet descriptor fields (_wkltId/_jsFnId/_wvid/elementRefptr).')
    if (markers === 1) {
      if ('_c' in rec) {
        const c = rec._c
        if (c === null || typeof c !== 'object' || Array.isArray(c))
          failCrossing(`${label}._c`, 'must be a plain object.')
        assertCrossableValue(`${label}._c`, c, seen)
      }
      return
    }
    if (Array.isArray(rec)) {
      for (let i = 0; i < rec.length; i++) {
        if (!(i in rec))
          failCrossing(`${label}[${i}]`, 'is a sparse array hole and becomes null after JSON serialization.')
        assertCrossableValue(`${label}[${i}]`, rec[i], seen)
      }
      return
    }
    if (rec instanceof Map)
      failCrossing(label, 'is a Map and serializes to {} (loses entries). Use a plain object.')
    if (rec instanceof Set)
      failCrossing(label, 'is a Set and serializes to {} (loses entries). Use an array.')
    if (rec instanceof WeakMap || rec instanceof WeakSet)
      failCrossing(label, 'is a WeakMap/WeakSet and cannot be JSON serialized.')
    if (rec instanceof Promise)
      failCrossing(label, 'is a Promise and cannot be JSON serialized. Await it or pass its resolved value.')
    if (rec instanceof Date)
      failCrossing(label, 'is a Date and becomes a string after serialization (loses Date methods). Pass a timestamp number or ISO string explicitly.')
    if (rec instanceof RegExp)
      failCrossing(label, 'is a RegExp and serializes to {} (loses pattern). Pass a string.')
    const proto: unknown = Object.getPrototypeOf(rec)
    if (proto !== Object.prototype && proto !== null)
      failCrossing(label, 'must be a plain object to cross by JSON. Class instances lose their methods (marker-carrying handles like MainThreadRef are exempt).')
    for (const [k, v] of Object.entries(rec))
      assertCrossableValue(`${label}.${k}`, v, seen)
  }
  finally {
    seen.delete(value)
  }
}

function failCrossing(label: string, reason: string): never {
  throw new TypeError(`Cannot send "${label}" across threads: ${reason}`)
}
