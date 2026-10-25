/**
 * Cross-thread call behavior (official JsFnHandle model):
 *
 *   runOnBackground — MT worklet dispatches (execId, fnId) to the BG; the BG
 *     resolves the root worklet via WorkletExecIdMap, DFS-finds the handle
 *     and calls its `_fn`.
 *   runOnMainThread — BG enqueues the registered ctx onto the ops batch and
 *     flushNow() ships it with INIT/SET_MT_REF in one callLepusMethod; the
 *     MT applyOps lands the refs, then lynxWorkletImpl._runRunOnMainThreadTask
 *     answers FunctionCallRet.
 *
 * Both sides share one fake event bus (getCoreContext === getJSContext).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerBgFunction, resetBgFunctionRegistry } from '../../packages/runtime/src/background/bg-function-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import {
  registerWorkletCtx,
  resetRunOnBackgroundState,
} from '../../packages/runtime/src/background/run-on-background'
import {
  resetRunOnBackgroundMtState,
} from '../../packages/runtime/src/main-thread/run-on-background-mt'

const g = globalThis

function installLynxBus(): void {
  const bus = new EventTarget()
  const makeContext = () => ({
    addEventListener: (t: string, h: (e: { data?: unknown }) => void) =>
      bus.addEventListener(t, h as EventListener),
    dispatchEvent: (e: { type: string, data?: string }) => {
      const ev = new Event(e.type, { cancelable: true })
      ;(ev as Event & { data?: string }).data = e.data
      bus.dispatchEvent(ev)
    },
  })
  ;(g as { lynx: unknown }).lynx = {
    getCoreContext: makeContext,
    getJSContext: makeContext,
  }
}

beforeEach(async () => {
  resetRunOnBackgroundState()
  resetRunOnBackgroundMtState()
  resetBgFunctionRegistry()
  resetOpsBuffer()
  resetFlushState()
  installLynxBus()
  // lynxSolidApplyOps mid-batch flushes when the batch carries worklets + ops.
  ;(g as Record<string, unknown>).__FlushElementTree = () => {}
  // main-thread bootstrap (official runtime globals are stubbed here; the
  // runOnBackground global comes from run-on-background-mt)
  await import('../../packages/runtime/src/main-thread/index')
})

describe('cross-thread calls', () => {
  it('runOnBackground: MT dispatch (execId, fnId) invokes the BG _fn and resolves', async () => {
    let called: unknown[] | null = null
    const closeHandle = registerBgFunction((...args: unknown[]) => {
      called = args
      return 'bg-result'
    })

    // BG assembles and registers the root ctx — official model: stamp root _execId
    const rootCtx: Record<string, unknown> = {
      _wkltId: '__root__',
      _c: { closeRef: closeHandle },
    }
    registerWorkletCtx(rootCtx)
    expect(rootCtx._execId).toBeGreaterThan(0)

    // MT-side compiled shape: runOnBackground(this._c.closeRef)(args).
    // globalThis.runOnBackground comes from run-on-background-mt (registered by index.js).
    // eslint-disable-next-line no-useless-call -- proving arg pass-through verbatim
    const p = g.runOnBackground?.({ _jsFnId: closeHandle._jsFnId, _execId: rootCtx._execId as number | undefined }).apply(null, ['a', 1])
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(called).toEqual(['a', 1])
    await expect(p).resolves.toBe('bg-result')
  })

  it('releaseBackgroundWorkletCtx removes entries; garbage is tolerated', async () => {
    let calledB: unknown[] | null = null
    const handleB = registerBgFunction((...args: unknown[]) => {
      calledB = args
      return 'b-result'
    })
    const rootB: Record<string, unknown> = { _wkltId: '__rootB__', _c: { closeRef: handleB } }
    registerWorkletCtx(rootB)
    const execIdB = rootB._execId as number
    const bus: any = (g.lynx as any).getCoreContext()

    const delSpy = vi.spyOn(Map.prototype, 'delete')
    try {
      // Garbage tolerated: unparsable string, non-array payload, non-number entries.
      bus.dispatchEvent({ type: 'Lynx.Worklet.releaseBackgroundWorkletCtx', data: 'not-json{{{' })
      bus.dispatchEvent({ type: 'Lynx.Worklet.releaseBackgroundWorkletCtx', data: JSON.stringify({ nope: 1 }) })
      bus.dispatchEvent({ type: 'Lynx.Worklet.releaseBackgroundWorkletCtx', data: ['x', null] })
      // Selective removal (9999 unknown → Map.delete no-op).
      bus.dispatchEvent({ type: 'Lynx.Worklet.releaseBackgroundWorkletCtx', data: [execIdB, 9999] })
      expect(delSpy).toHaveBeenCalledWith(execIdB)
    }
    finally {
      delSpy.mockRestore()
    }

    // Bus + registry still functional for survivors.
    let calledC: unknown[] | null = null
    const handleC = registerBgFunction((...args: unknown[]) => {
      calledC = args
      return 'c-result'
    })
    const rootC: Record<string, unknown> = { _wkltId: '__rootC__', _c: { closeRef: handleC } }
    registerWorkletCtx(rootC)
    // eslint-disable-next-line no-useless-call -- same verbatim dispatch shape as above
    const p = g.runOnBackground?.({ _jsFnId: handleC._jsFnId, _execId: rootC._execId as number | undefined }).apply(null, ['z'])
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(calledC).toEqual(['z'])
    await expect(p).resolves.toBe('c-result')
    expect(calledB).toBeNull()
  })

  it('runOnMainThread: rejects uncrossable params before dispatch', async () => {
    const { runOnMainThread } = await import('../../packages/runtime/src/background/run-on-background')
    const call = runOnMainThread({ _wkltId: 'w', _c: {} })
    await expect(call(new Map())).rejects.toThrow(/param\[0\].*Map/)
    await expect(call('ok', { nested: [1n] })).rejects.toThrow(/nested\[0\].*bigint/)
  })

  it('runOnMainThread: fails loud on a plain function that skipped the transform', async () => {
    const { runOnMainThread } = await import('../../packages/runtime/src/background/run-on-background')
    const call = runOnMainThread(() => 'x')
    await expect(call()).rejects.toThrow(/did not compile/)
  })

  it('runOnMainThread: rides the ops batch; MT applies ops then runs the worklet', async () => {
    // Official worklet-runtime surface the MT entry calls after applyOps.
    ;(g as { lynxWorkletImpl?: unknown }).lynxWorkletImpl = {
      _runRunOnMainThreadTask: (_task: unknown, _params: unknown, resolveId: number) => {
        ;(g.lynx as { getJSContext: () => { dispatchEvent: (e: { type: string, data: string }) => void } })
          .getJSContext()
          .dispatchEvent({
            type: 'Lynx.Worklet.FunctionCallRet',
            data: JSON.stringify({ resolveId, returnValue: 15 }),
          })
      },
    }
    // BG executor → MT lynxSolidApplyOps (what entry.ts wires via callLepusMethod).
    setOpsExecutor((ops, worklets) => {
      ;(g as { lynxSolidApplyOps?: (p: { data: string, worklets?: string }) => void })
        .lynxSolidApplyOps?.({
          data: JSON.stringify(ops),
          worklets: worklets?.length ? JSON.stringify(worklets) : undefined,
        })
    })

    const { runOnMainThread } = await import('../../packages/runtime/src/background/run-on-background')
    const call = runOnMainThread({
      _wkltId: 'bdbc:t',
      _c: {},
    })
    await expect(call(5)).resolves.toBe(15)
  })

  it('runOnMainThread: INIT_MT_REF from the same tick ships in the batch before the worklet runs', async () => {
    const order: string[] = []
    ;(g as { lynxWorkletImpl?: unknown }).lynxWorkletImpl = {
      _runRunOnMainThreadTask: (_t: unknown, _p: unknown, resolveId: number) => {
        order.push('worklet')
        ;(g.lynx as { getJSContext: () => { dispatchEvent: (e: { type: string, data: string }) => void } })
          .getJSContext()
          .dispatchEvent({
            type: 'Lynx.Worklet.FunctionCallRet',
            data: JSON.stringify({ resolveId, returnValue: 'ok' }),
          })
      },
    }
    setOpsExecutor((ops, worklets) => {
      order.push('applyOps')
      ;(g as { lynxSolidApplyOps?: (p: { data: string, worklets?: string }) => void })
        .lynxSolidApplyOps?.({
          data: JSON.stringify(ops),
          worklets: worklets?.length ? JSON.stringify(worklets) : undefined,
        })
    })

    // Simulate the render tick: ref op pushed, then runOnMainThread.
    const { pushOp } = await import('../../packages/runtime/src/background/ops-buffer')
    const { OP } = await import('../../packages/runtime/src/internal/ops')
    pushOp(OP.INIT_MT_REF, 1, null)

    const { runOnMainThread } = await import('../../packages/runtime/src/background/run-on-background')
    const call = runOnMainThread({ _wkltId: 'bdbc:order', _c: {} })
    await expect(call()).resolves.toBe('ok')
    expect(order).toEqual(['applyOps', 'worklet'])
  })
})
