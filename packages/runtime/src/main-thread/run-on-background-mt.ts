/**
 * MT-side runOnBackground — dispatches function calls from the Main Thread
 * to the Background Thread via 'Lynx.Worklet.runOnBackground' events.
 *
 * Ported verbatim from the equivalent module in vue-lynx
 * (https://github.com/Huxpro/vue-lynx, Apache-2.0). The fork compiler rewrites
 * `runOnBackground(handle)(args)` inside extracted worklet bodies into a call
 * to this global with the JsFnHandle resolved from `this._c`.
 */

import type { JsFnHandle } from '../internal/js-fn-handle'
import { assertCrossableValue } from '../internal/clone-safe'

const RUN_ON_BACKGROUND = 'Lynx.Worklet.runOnBackground'
const FUNCTION_CALL_RET = 'Lynx.Worklet.FunctionCallRet'

// ---------------------------------------------------------------------------
// Return value resolver (MT-side, mirrors BG's function-call.ts)
// ---------------------------------------------------------------------------

let resolveMap: Map<number, (v: unknown) => void> | undefined
let nextResolveId = 1

function initReturnListener(): void {
  resolveMap = new Map()
  lynx.getJSContext().addEventListener(FUNCTION_CALL_RET, (event: { data?: unknown }) => {
    const { resolveId, returnValue } = JSON.parse(event.data as string) as {
      resolveId: number
      returnValue: unknown
    }
    const resolve = resolveMap!.get(resolveId)
    if (resolve) {
      resolveMap!.delete(resolveId)
      resolve(returnValue)
    }
  })
}

// ---------------------------------------------------------------------------
// dispatch — send the event to BG thread
// ---------------------------------------------------------------------------

function dispatch(
  fnId: number,
  params: unknown[],
  execId: number,
  resolveId: number,
): void {
  lynx.getJSContext().dispatchEvent({
    type: RUN_ON_BACKGROUND,
    data: JSON.stringify({
      obj: { _jsFnId: fnId, _execId: execId },
      params,
      resolveId,
    }),
  })
}

// ---------------------------------------------------------------------------
// runOnBackground — the global function called in extracted worklet code
// ---------------------------------------------------------------------------

export type { JsFnHandle } from '../internal/js-fn-handle'

export function runOnBackground(
  handle: JsFnHandle,
): (...args: unknown[]) => Promise<unknown> {
  return async (...params: unknown[]): Promise<unknown> => {
    // Validate before touching anything: uncrossable params would silently
    // corrupt on the BG side, far from this call site.
    params.forEach((p, i) => assertCrossableValue(`param[${i}]`, p))
    return new Promise((resolve) => {
      if (!resolveMap)
        initReturnListener()
      const resolveId = nextResolveId++
      resolveMap!.set(resolveId, resolve)

      // First-screen delay (worklet-runtime handles this if needed).
      // Official type declares lynxWorkletImpl as required; cast to
      // optional for runtime guard before IIFE loads.
      const delayImpl = globalThis
        .lynxWorkletImpl
        ?._runOnBackgroundDelayImpl
      if (handle._isFirstScreen && delayImpl) {
        delayImpl.delayRunOnBackground(
          handle,
          (fnId: number, execId: number) => {
            dispatch(fnId, params, execId, resolveId)
          },
        )
        return
      }

      dispatch(handle._jsFnId!, params, handle._execId!, resolveId)
    })
  }
}

/** Reset module state — for testing only. */
export function resetRunOnBackgroundMtState(): void {
  resolveMap = undefined
  nextResolveId = 1
}
