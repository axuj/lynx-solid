/**
 * runOnBackground — BG-side registration and event handling.
 *
 * Ported from the equivalent module in vue-lynx
 * (https://github.com/Huxpro/vue-lynx, Apache-2.0), which in turn ports
 * ReactLynx's execMap.ts + runOnBackground.ts + indexMap.ts
 * (https://github.com/lynx-family/lynx-stack, Apache-2.0).
 *
 * Model: every root worklet context sent to the MT is registered via
 * `registerWorkletCtx(ctx)` — that stamps a unique `_execId` onto the ctx
 * and remembers the tree. When the MT dispatches
 * 'Lynx.Worklet.runOnBackground' with (execId, fnId), we find the root
 * worklet, DFS for the JsFnHandle carrying `_jsFnId`, and invoke its `_fn`.
 */

import type { WorkletCtx } from './attr-core'
import type { FoundJsFnHandle } from './bg-function-registry'
import { assertCrossableValue } from '../internal/clone-safe'
import { enqueueWorklet, flushNow } from './flush'

const RUN_ON_BACKGROUND = 'Lynx.Worklet.runOnBackground'
const FUNCTION_CALL_RET = 'Lynx.Worklet.FunctionCallRet'
const RELEASE_BG_WORKLET_CTX = 'Lynx.Worklet.releaseBackgroundWorkletCtx'

// ---------------------------------------------------------------------------
// IndexMap — auto-incrementing Map (port of React's indexMap.ts)
// ---------------------------------------------------------------------------

class IndexMap<T> {
  private lastIndex = 0
  private map = new Map<number, T>()

  add(value: T): number {
    const id = ++this.lastIndex
    this.map.set(id, value)
    return id
  }

  get(index: number): T | undefined {
    return this.map.get(index)
  }

  remove(index: number): void {
    this.map.delete(index)
  }
}

// ---------------------------------------------------------------------------
// WorkletExecIdMap — stamps _execId, finds JsFnHandle by (execId, fnId)
// ---------------------------------------------------------------------------

/**
 * A node in a BG worklet tree: known marker/handle fields plus an index
 * signature for arbitrary user captures (recursively `TreeValue`).
 * Unknown-typed data enters only through `registerWorkletCtx` (one
 * justified assertion); everything downstream is statically typed.
 */
interface WorkletTreeNode {
  _wkltId?: string
  _jsFnId?: number
  _execId?: number
  _wvid?: number
  _error?: string
  _isFirstScreen?: boolean
  _fn?: (...args: unknown[]) => unknown
  [key: string]: TreeValue | undefined
}

type TreeValue
  = | string | number | boolean | null | undefined | bigint | symbol
    | ((...args: never[]) => unknown)
    | WorkletTreeNode
    | TreeValue[]

class WorkletExecIdMap extends IndexMap<WorkletTreeNode> {
  // Root-only stamp — matches the equivalent module in vue-lynx
  // (https://github.com/Huxpro/vue-lynx, Apache-2.0) and upstream exec-map
  // exactly. Nested `_jsFnId` handles inherit the root `_execId` when the
  // engine runs the official worklet transform at fire time —
  // never here, and never in a bind-time pre-transform (which would seal
  // unresolved refs inside bound copies; see worklet-missing.md).
  override add(worklet: WorkletTreeNode): number {
    const execId = super.add(worklet)
    worklet._execId = execId
    return execId
  }

  findJsFnHandle(execId: number, fnId: number): FoundJsFnHandle | undefined {
    const worklet = this.get(execId)
    if (!worklet)
      return undefined

    const visited = new Set<object>()
    const search = (value: TreeValue): FoundJsFnHandle | undefined => {
      if (value === null || typeof value !== 'object')
        return undefined
      if (visited.has(value))
        return undefined
      visited.add(value)
      if (Array.isArray(value)) {
        for (const item of value) {
          const result = search(item)
          if (result)
            return result
        }
        return undefined
      }
      if ('_jsFnId' in value && value._jsFnId === fnId) {
        return value
      }
      for (const key in value) {
        const result = search(value[key])
        if (result)
          return result
      }
      return undefined
    }

    return search(worklet)
  }
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

interface RunOnBackgroundData {
  obj: { _jsFnId: number, _execId: number }
  params: unknown[]
  resolveId: number
}

let execIdMap: WorkletExecIdMap | undefined

function ensureInit(): void {
  if (!execIdMap) {
    execIdMap = new WorkletExecIdMap()
    lynx.getCoreContext().addEventListener(RUN_ON_BACKGROUND, runJSFunction)
    lynx.getCoreContext().addEventListener(RELEASE_BG_WORKLET_CTX, releaseBackgroundWorkletCtx)
  }
}

/**
 * Release worklet ctx entries the MT no longer retains. Mirrors official
 * `releaseBackgroundFunctionCtx` (lynx-stack run-on-background.ts): the MT
 * worklet-runtime fires this when its refcount drops to zero. Data is an
 * array of execIds (stringified form tolerated — engine marshalling varies
 * by host); anything else is ignored. Unknown ids are no-ops (Map.delete).
 */
function releaseBackgroundWorkletCtx(event: { data?: unknown }): void {
  let ids: unknown = event.data
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids)
    }
    catch {
      return
    }
  }
  if (!Array.isArray(ids))
    return
  for (const id of ids) {
    if (typeof id === 'number')
      execIdMap!.remove(id)
  }
}

// ---------------------------------------------------------------------------
// registerWorkletCtx — call before sending worklet ctx to MT via ops
// ---------------------------------------------------------------------------

export function registerWorkletCtx(ctx: Record<string, unknown>): void {
  ensureInit()
  execIdMap!.add(ctx as WorkletTreeNode) // as: single assertion at registration entry, compiler-stamped worklet tree; fully static downstream
}

// ---------------------------------------------------------------------------
// runJSFunction — receives MT dispatch, finds _fn, calls it, returns value
// ---------------------------------------------------------------------------

function runJSFunction(event: { data?: unknown }): void {
  const data = JSON.parse(event.data as string) as RunOnBackgroundData // as: cross-boundary postMessage+JSON, no narrow
  const handle = execIdMap!.findJsFnHandle(data.obj._execId, data.obj._jsFnId)
  if (!handle || typeof handle._fn !== 'function') {
    throw new Error(
      handle?._error
      ?? `runOnBackground: JS function not found (execId=${data.obj._execId}, fnId=${data.obj._jsFnId})`,
    )
  }
  // NOTE: returnValue is deliberately NOT validated — a throw here would
  // land in the engine listener context (uncatchable, host-dependent),
  // while params validation above throws into the caller (catchable).
  const returnValue = handle._fn(...data.params)
  lynx.getCoreContext().dispatchEvent({
    type: FUNCTION_CALL_RET,
    data: JSON.stringify({ resolveId: data.resolveId, returnValue }),
  })
}

// ---------------------------------------------------------------------------
// BG-side resolve registry — for runOnMainThread return values
// ---------------------------------------------------------------------------

let resolveMap: Map<number, (value: unknown) => void> | undefined
let nextResolveId = 1

/** Register a resolve callback and return its unique ID. */
export function onFunctionCall(resolve: (value: unknown) => void): number {
  if (!resolveMap) {
    resolveMap = new Map()
    lynx.getCoreContext().addEventListener(FUNCTION_CALL_RET, (event) => {
      const data = JSON.parse(String((event as { data?: unknown }).data)) as { // as: cross-boundary event+JSON, no narrow
        resolveId: number
        returnValue: unknown
      }
      resolveMap!.get(data.resolveId)?.(data.returnValue)
      resolveMap!.delete(data.resolveId)
    })
  }
  const id = nextResolveId++
  resolveMap.set(id, resolve)
  return id
}

/**
 * Call a worklet on the Main Thread from the Background Thread.
 *
 * Source-level callers pass the worklet function itself; the official
 * SWC transform swaps the definition for a `WorkletCtx` descriptor
 * (`{ _wkltId, _c?, _jsFn? }`) before this ever runs. The union accepts
 * both shapes so call sites need no cast. A plain function reaching
 * runtime means the module skipped the transform — fail loud instead
 * of JSON-dropping it into a promise that never resolves.
 *
 * The ctx is registered (stamping the root `_execId`) and **queued onto
 * the next ops batch** (`enqueueWorklet` + `flushNow`) so the MT runs it
 * only after `applyOps` has applied INIT/SET_MT_REF from the same render
 * tick — the official delayed-payload order, not a bare dispatchEvent
 * that can overtake the microtask flush. Return value resolves from
 * FunctionCallRet (unchanged).
 */
export function runOnMainThread<R, A extends unknown[]>(
  worklet: ((...args: A) => R) | WorkletCtx,
): (...args: A) => Promise<R> {
  return async (...params: A): Promise<R> => {
    // Validate before touching anything: uncrossable params would silently
    // corrupt on the MT side, far from this call site.
    params.forEach((p, i) => assertCrossableValue(`param[${i}]`, p))
    if (typeof worklet === 'function') {
      throw new TypeError(
        'runOnMainThread() received a plain function — the worklet transform '
        + 'did not compile this module, so there is no descriptor to dispatch.',
      )
    }
    return new Promise<R>((resolve) => {
      const resolveId = onFunctionCall(resolve as (value: unknown) => void) // as: contravariant param R → unknown, no narrow
      registerWorkletCtx(worklet)
      enqueueWorklet({ worklet, params, resolveId })
      flushNow()
    })
  }
}

/** Reset module state — for testing only. */
export function resetRunOnBackgroundState(): void {
  execIdMap = undefined
  resolveMap = undefined
  nextResolveId = 1
}

// ---------------------------------------------------------------------------
// Stub for user-side import (the compiler replaces all call sites)
// ---------------------------------------------------------------------------

/**
 * Call a Background Thread function from a `'main thread'` worklet.
 *
 * The fork compiler rewrites every `runOnBackground(handle)(args)` call site
 * inside worklet bodies into `runOnBackground(<resolved handle>)(...)` against
 * the MT global (see main-thread/run-on-background-mt.ts). This export exists
 * only for TypeScript import resolution on the BG thread.
 */
export function runOnBackground<R = unknown, Fn extends (...args: unknown[]) => R = (...args: unknown[]) => R>(
  _fnRef: unknown,
): (...args: Parameters<Fn>) => Promise<R> {
  throw new Error(
    'runOnBackground() can only be used inside \'main thread\' functions; '
    + 'the worklet transform should have rewritten this call.',
  )
}
