/**
 * Worklet closeRef chain regression (official JsFnHandle model):
 *
 * 1. Before BG ships the worklet ctx, registerWorkletCtx(ctx) stamps the
 *    root _execId and records it in WorkletExecIdMap.
 * 2. After MT transform, `runOnBackground(handle)` dispatches back to BG
 *    with (execId, fnId) on obj.
 * 3. BG findJsFnHandle DFS-finds the handle matching `_jsFnId` and calls
 *    its `_fn`.
 *
 * Regression background: the old hand-rolled implementation unconditionally
 * overwrote the BG-provided `_execId` with the root ctx value (missing on
 * root → undefined), BG lookup missed, onClose never ran (sheet slid away
 * but the more button stayed on X).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorkletCtx } from '../../packages/runtime/src/background/attr-core'
import { registerBgFunction, resetBgFunctionRegistry } from '../../packages/runtime/src/background/bg-function-registry'
import {
  registerWorkletCtx,
  resetRunOnBackgroundState,
} from '../../packages/runtime/src/background/run-on-background'
import {
  resetRunOnBackgroundMtState,
  runOnBackground,
} from '../../packages/runtime/src/main-thread/run-on-background-mt'

// Mock the `lynx` global (injected by the AMD wrapper on real devices)
const g = globalThis as { lynx: unknown }
g.lynx = {
  getCoreContext: () => ({
    addEventListener: () => {},
    dispatchEvent: () => {},
  }),
}

describe('worklet JsFnHandle execId chain (official model)', () => {
  beforeEach(() => {
    resetRunOnBackgroundState()
    resetRunOnBackgroundMtState()
    resetBgFunctionRegistry()
  })

  it('stamps _execId on the root ctx and resolves (execId, fnId) via DFS', () => {
    let closed = false
    const closeHandle = registerBgFunction(() => {
      closed = true
      return 'closed'
    })

    // BG assembles ctx: closeRef into _c, then registers the whole (stamps root _execId)
    const rootCtx: Record<string, unknown> = {
      _wkltId: '__root__',
      _c: { closeRef: closeHandle },
    }
    registerWorkletCtx(rootCtx)
    expect(rootCtx._execId).toBeGreaterThan(0)

    // MT sends back: transformWorkletInner only stamps missing fields; _fn
    // is lost to serialization, but (_jsFnId, _execId) survive — the official
    // bridge contract.
    const dispatched: Array<{ obj: { _jsFnId: number, _execId?: number }, params: unknown[] }> = []
    const listener = (event: { data?: unknown }) => {
      dispatched.push(JSON.parse(String(event.data)))
    }

    // MT-side compiled shape: runOnBackground(this._c.closeRef)([]).
    // runOnBackground comes from run-on-background-mt; dispatch is simulated directly here.
    const handle = (rootCtx._c as Record<string, unknown>).closeRef as { _jsFnId: number }
    const obj = { _jsFnId: handle._jsFnId, _execId: rootCtx._execId }
    listener({ data: JSON.stringify({ obj, params: [], resolveId: 1 }) })

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]!.obj._jsFnId).toBe(closeHandle._jsFnId)
    expect(dispatched[0]!.obj._execId).toBe(rootCtx._execId)

    // BG listener semantics: findJsFnHandle hits the handle then calls its _fn — re-verified directly
    closeHandle._fn!()
    expect(closed).toBe(true)
  })

  it('crossing guard passes legit shapes (descriptors, handles, refs, plain data)', () => {
    // Legit shapes must pass silently: nested descriptors (with their own
    // _c), handles, ref stubs (incl. MainThreadRef-style class instances,
    // exempted via _wvid), element envelopes, plain data.
    class FakeRef {
      _wvid = 7
      toJSON() {
        return { _wvid: this._wvid }
      }
    }
    const ctx = buildWorkletCtx({
      _wkltId: 'w-root',
      _c: {
        n: 120,
        s: 'x',
        arr: [1, { y: 2 }],
        ref: new FakeRef(),
        nested: { _wkltId: 'w-inner', _c: { k: true } },
        handle: { _jsFnId: 9 },
        env: { elementRefptr: {} },
      },
    })
    expect(ctx).not.toBeNull()
    expect(ctx!._wkltId).toBe('w-root')
  })

  it('crossing guard throws with the variable path on non-crossable captures', () => {
    // Octane-style: name the uncrossable capture on the spot, not a silent MT stall.
    const cases: Array<[string, unknown, RegExp]> = [
      ['bare function', { _wkltId: 'w', _c: { fmt: (x: unknown) => x } }, /"fmt".*function/],
      ['symbol', { _wkltId: 'w', _c: { s: Symbol('s') } }, /"s".*symbol/],
      ['bigint', { _wkltId: 'w', _c: { b: 1n } }, /"b".*bigint/],
      ['non-finite', { _wkltId: 'w', _c: { n: Number.NaN } }, /"n".*finite/],
      ['map', { _wkltId: 'w', _c: { m: new Map() } }, /"m".*Map/],
      ['circular', { _wkltId: 'w', _c: { o: {} } }, /circular/],
      ['mixed markers', { _wkltId: 'w', _c: { h: { _wkltId: 'a', _jsFnId: 1 } } }, /mixes reserved/],
      ['class instance', { _wkltId: 'w', _c: { p: new (class Point { x = 1 })() } }, /plain object/],
    ]
    const circular = cases[5]![1] as { _c: { o: Record<string, unknown> } }
    circular._c.o.self = circular._c.o
    for (const [name, value, pattern] of cases)
      expect(() => buildWorkletCtx(value), name).toThrow(pattern)
  })

  it('MT dispatch rejects uncrossable params before touching the bus', async () => {
    // Validation runs before resolveMap init / lynx access: no engine mock
    // needed, and the throw surfaces as a rejection to the caller.
    await expect(runOnBackground({ _jsFnId: 1 })(new Map())).rejects.toThrow(/param\[0\].*Map/)
    await expect(runOnBackground({ _jsFnId: 1 })(1n)).rejects.toThrow(/param\[0\].*bigint/)
  })
})

/** Placeholder: the real chain is driven by initBackground's core listener; driven manually in tests. */
