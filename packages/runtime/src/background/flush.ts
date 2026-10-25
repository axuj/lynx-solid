/**
 * Flush scheduling: batches all ops from one render tick into a single
 * cross-thread delivery, and ships pending `runOnMainThread` worklets in
 * the **same payload** so the MT can apply refs before running them
 * (kills the send-order race against `Lynx.Worklet.runWorkletCtx`).
 *
 * The transport is injected via setOpsExecutor so the same code path serves
 * two deployments:
 *   - dual-thread (Lynx Web / native): entry.ts wires it to
 *     `nativeApp.callLepusMethod('lynxSolidApplyOps', ...)`;
 *   - single-process (tests): the local applyOps runs on the same thread.
 */

import { scheduleMicrotask } from '../internal/microtask'
import { flushBatchTeardown, resetTeardown } from './batch-teardown'
import { takeOps } from './ops-buffer'

/**
 * A `runOnMainThread` dispatch queued for the next ops batch — same wire
 * shape as the official `RunWorkletCtxData` (`{ resolveId, worklet, params }`,
 * key order irrelevant). `worklet` is the compiler-stamped ctx descriptor
 * (`{ _wkltId, _c, _execId }`), already `registerWorkletCtx`'d on the BG.
 */
export interface PendingWorklet {
  worklet: Record<string, unknown>
  params: unknown[]
  resolveId: number
}

type OpsExecutor = (ops: unknown[], worklets?: PendingWorklet[]) => void

let executor: OpsExecutor | null = null
let scheduled = false
let pendingWorklets: PendingWorklet[] = []

/** Install the transport that receives drained ops batches. */
export function setOpsExecutor(fn: OpsExecutor): void {
  executor = fn
}

/** Current transport, if any (entry.ts uses this to avoid clobbering tests). */
export function getOpsExecutor(): OpsExecutor | null {
  return executor
}

/** Coalescing flag; true while a flush is already queued. */
export function isFlushScheduled(): boolean {
  return scheduled
}

/** Queue a `runOnMainThread` dispatch for the next drain. */
export function enqueueWorklet(w: PendingWorklet): void {
  pendingWorklets.push(w)
}

/** Drain pending worklets (empty array when none). */
export function takePendingWorklets(): PendingWorklet[] {
  const batch = pendingWorklets
  pendingWorklets = []
  return batch
}

/**
 * Schedule a flush at the end of the current microtask queue. Idempotent.
 * Goes through the engine (`lynx.queueMicrotask`) rather than the bare global:
 * that global exists for the framework the runtime hosts (solid's mount path
 * calls it by name — internal/queue-microtask-shim), not for our own code, so
 * the flush must not assume it was installed at all — see internal/microtask.ts.
 */
export function scheduleFlush(): void {
  if (scheduled)
    return
  scheduled = true
  scheduleMicrotask(doFlush)
}

/**
 * Drain ops + worklets **now**, cancelling any pending microtask flush.
 * `runOnMainThread` calls this so the ref ops from the same render tick
 * ride the same `callLepusMethod` payload as the worklet — matching the
 * official delayed-payload order (apply refs → run worklets).
 */
export function flushNow(): void {
  scheduled = false
  drain()
}

/** Reset module state – for testing only. */
export function resetFlushState(): void {
  scheduled = false
  executor = null
  pendingWorklets = []
  // Belt: the batch window must never leak into the next test even if a
  // suite forgets resetNodeOpsState.
  resetTeardown()
}

function doFlush(): void {
  scheduled = false
  drain()
}

function drain(): void {
  // Cleanup obligations wait for an executor: flushing them into a batch
  // that would then be dropped (none wired yet) loses them forever — plain
  // frames keep the legacy drop semantics. Flush pushes the batch tail
  // (REMOVE_EVENT then RELEASE — wire order lives in batch-teardown.ts).
  if (executor)
    flushBatchTeardown()
  const ops = takeOps()
  const worklets = takePendingWorklets()
  if (ops.length === 0 && worklets.length === 0)
    return
  if (!executor)
    return
  executor(ops, worklets.length > 0 ? worklets : undefined)
}
