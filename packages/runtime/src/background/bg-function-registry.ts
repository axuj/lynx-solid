/**
 * BG-side function registry for `runOnBackground` — official JsFnHandle model.
 *
 * The handle `{_jsFnId, _fn}` keeps the function by reference on the BG side
 * (it never crosses the thread boundary: ops serialization drops `_fn` via
 * toJSON, and the MT dispatches back `(execId, fnId)` so we can DFS the
 * registered worklet tree for the live handle). Mirrors the object shape the
 * official SWC worklet transform injects at build time.
 */
import type { JsFnHandle } from '../internal/js-fn-handle'

export interface BgFnHandle {
  _jsFnId: number
  _fn?: (...args: unknown[]) => unknown
  _error?: string
  _isFirstScreen?: boolean
  _execId?: number
  /** Serialization-safe view — `_fn` never crosses the thread. */
  toJSON: () => { _jsFnId: number, _isFirstScreen?: boolean }
}

/**
 * A JsFnHandle as found by DFS in BG worklet trees (`findJsFnHandle`):
 * the wire shape plus the live `_fn` when the found object is a registered
 * handle. Plain `{_jsFnId}` descriptors from SWC lack `_fn` — callers must
 * check `typeof handle._fn === 'function'` before invoking.
 */
export interface FoundJsFnHandle extends JsFnHandle {
  _fn?: (...args: unknown[]) => unknown
}

let nextFnId = 0
const handles = new Map<number, BgFnHandle>()

/** Register a BG function so a worklet can call it (via runOnBackground). */
export function registerBgFunction(
  fn: (...args: unknown[]) => unknown,
): BgFnHandle {
  const fnId = ++nextFnId
  const handle: BgFnHandle = {
    _jsFnId: fnId,
    _fn: fn,
    toJSON() {
      return { _jsFnId: fnId }
    },
  }
  handles.set(fnId, handle)
  return handle
}

/**
 * Transform a BG-side function into a JsFnHandle for cross-thread dispatch.
 * Called by SWC-generated code (`transformToWorklet(fn)` in `_jsFn` maps) —
 * same contract as the equivalent transform in vue-lynx
 * (https://github.com/Huxpro/vue-lynx, Apache-2.0). The `_fn` reference never
 * crosses the thread (toJSON drops it); the MT dispatches back `(execId, fnId)`
 * and the BG DFS resolves the live handle.
 */
export function transformToWorklet(
  fn: (...args: unknown[]) => unknown,
): BgFnHandle {
  // Already a handle (e.g. registerBgFunction result captured by SWC into
  // `_jsFn`): pass through instead of double-wrapping, or the MT dispatch
  // would resolve a handle whose `_fn` is another handle, not a function.
  if (
    typeof fn === 'object'
    && fn !== null
    && typeof (fn as { _jsFnId?: unknown })._jsFnId === 'number'
    && typeof (fn as { _fn?: unknown })._fn === 'function'
  ) {
    return fn as BgFnHandle
  }
  const fnId = ++nextFnId
  // Non-function input: vue contract returns `{_jsFnId, _error}` without
  // registering (runJSFunction surfaces it); toJSON drops everything but
  // the id so no dead closure crosses the thread.
  if (typeof fn !== 'function') {
    return {
      _jsFnId: fnId,
      _error: `Argument of runOnBackground should be a function, got [${typeof fn}]`,
      toJSON() {
        return { _jsFnId: fnId }
      },
    }
  }
  return registerBgFunction(fn)
}

/** Reset module state — for testing only. */
export function resetBgFunctionRegistry(): void {
  handles.clear()
  nextFnId = 0
}
