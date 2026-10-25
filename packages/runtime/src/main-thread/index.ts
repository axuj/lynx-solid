/**
 * Main Thread (Lepus) bootstrap entry.
 *
 * Module-side-effect wiring, evaluated when the main-thread bundle loads:
 * the Lepus runtime calls these globals directly, so there is no explicit
 * init() — unlike the BG side, which controls its own injection point.
 *
 * The worklet runtime itself is the official
 * `@lynx-js/react/worklet-runtime` bundle (self-initializing IIFE: installs
 * globalThis.lynxWorkletImpl, registerWorklet, runWorklet, the
 * Lynx.Worklet.runWorkletCtx listener and timer polyfills) — same reuse
 * model as vue-lynx. This entry only wires our flat ops protocol and the
 * `runOnBackground` global the compiler emits inside worklet bodies.
 *
 *   - lynxSolidApplyOps — receives ops from the BG thread (the contract name
 *     declared as APPLY_OPS_METHOD in background/entry.ts)
 *   - renderPage       — creates the page root (id=1) and presents the frame
 *   - processData      — required by the Lepus runtime; pass data through
 *   - updatePage / updateGlobalProps — required stubs; no data binding on MT
 */

import { PAGE_ROOT_ID } from '../internal/ops'
import { logOps } from '../internal/ops-log'
import {
  elements,
  resetMainThreadState,
  setPageUniqueId,
} from './element-registry'
import { applyOps } from './ops-apply'
import { runOnBackground } from './run-on-background-mt'
import { registerSkeleton } from './skeleton-registry'

// Compiled skeleton modules call `registerSkeleton(id, createCode)` as a
// bare global — same pattern as `runOnBackground`.
globalThis.registerSkeleton = registerSkeleton

// Expose SystemInfo on globalThis — worklet-runtime's version.js reads the
// bare `SystemInfo` global. Mirror lynx.SystemInfo (MT injects it on the lynx
// object, not the global), keep an engine-provided global. No `{}` standby:
// missing SystemInfo should surface as a hard error, not a silent fake.
// Mirrors the same setup in vue-lynx (https://github.com/Huxpro/vue-lynx,
// Apache-2.0), minus its `?? {}` fallback.
globalThis.SystemInfo = (typeof lynx !== 'undefined'
  ? (lynx as { SystemInfo?: typeof SystemInfo }).SystemInfo // as: engine global, type omits it; present at runtime
  : undefined)
?? globalThis.SystemInfo

// Compiled worklet bodies call `runOnBackground(handle)(args)` — the same
// bare global the official SWC LEPUS pass generates — vue-lynx
// (https://github.com/Huxpro/vue-lynx, Apache-2.0) registers it for the
// identical reason.
globalThis.runOnBackground = runOnBackground

globalThis.processData = function (data: unknown, _processorName?: string): unknown {
  return data ?? {}
}

// Lynx calls renderPage first (before BG JS runs). Create the root element
// and register it as id=1 so BG ops targeting the root resolve correctly.
globalThis.renderPage = function (_data: unknown): void {
  resetMainThreadState()
  const page = __CreatePage('0', 0)
  __SetCSSId([page], 0)
  setPageUniqueId(__GetElementUniqueID(page))
  elements[PAGE_ROOT_ID] = page

  // MT-IFR (opt-in at build time, see pluginSolidLynx `enableMtIfr`): the app
  // entry already called `render()` while the bundle evaluated, so paint the
  // first screen here instead of showing an empty page until the background
  // boots. The hook is installed by `main-thread/ifr-runtime`, which the
  // plugin injects into the MT entry ONLY for IFR builds — a non-IFR bundle
  // must not carry it, so the call is optional rather than an import.
  //
  // Exactly one flush per first screen: the mount renders AND presents the
  // frame, and it reports that by returning true. Flushing again here would
  // open a second engine pipeline for the same screen, which costs another
  // resolve/layout round and — because the engine's `TimingCollector` is a
  // global singleton keyed by mark name — overwrites the first round's marks,
  // turning our own first-frame entry into a mixed timeline (inverted
  // `resolveStart`, engine work appearing inside `mtsRender`). Measured with
  // the official Performance API entry, which is what exposed it.
  if (globalThis.__lynxSolidMountIfrRoot?.() !== true)
    __FlushElementTree()
}

globalThis.updatePage = function (_data: unknown): void {
  // no-op: reactive updates flow through ops, not data binding
}

globalThis.updateGlobalProps = function (_data: unknown): void {
  // no-op for MVP
}

// Called by the BG thread via callLepusMethod('lynxSolidApplyOps', { data, worklets? }).
// Order is load-bearing: applyOps lands INIT/SET_MT_REF first, then a
// __FlushElementTree so those elements have LynxUI before delayed
// runOnMainThread worklets run (official delayed-payload order for refs;
// we flush mid-batch because worklets may __InvokeUIMethod on the same
// nodes — "node N does not have a LynxUI" otherwise). A final flush after
// the worklets commits their style writes. Ops-only batches keep the
// historical flush-at-end-of-applyOps behavior.
globalThis.lynxSolidApplyOps = function (payload: { data: string, worklets?: string }): void {
  const ops = JSON.parse(payload.data) as unknown[]
  // IFR reconcile: when the main thread already painted this exact batch,
  // applying it again is a pure extra repaint. The worklets in the same
  // payload still have to run: the background's first flush is exactly where a
  // mount hook's `runOnMainThread` lands (motion starts its animation there),
  // and swallowing them leaves the MT with a painted-but-static first screen.
  // The hook is absent in non-IFR builds, so this is one optional call on the
  // hot path (same shape as __lynxSolidMountIfrRoot).
  const intercepted = globalThis.__lynxSolidInterceptBgOps?.(ops) === true
  const workletsJson = payload.worklets
  if (!intercepted)
    logOps(ops)

  const worklets = workletsJson
    ? JSON.parse(workletsJson) as Array<{
      worklet: Parameters<typeof globalThis.lynxWorkletImpl._runRunOnMainThreadTask>[0]
      params: Parameters<typeof globalThis.lynxWorkletImpl._runRunOnMainThreadTask>[1]
      resolveId: number
    }>
    : undefined
  const hasWorklets = !!worklets && worklets.length > 0

  if (!hasWorklets) {
    if (!intercepted)
      applyOps(ops)
    return
  }

  if (!globalThis.lynxWorkletImpl)
    throw new Error('[lynx-solid] runOnMainThread worklets in payload but worklet-runtime (lynxWorkletImpl) is not installed')

  if (!intercepted) {
    applyOps(ops, false)
    // Present the element tree before worklets: SET_MT_REF + CREATE must
    // become LynxUI before any invoke/boundingClientRect in this batch.
    if (ops.length > 0)
      __FlushElementTree()
  }
  for (const w of worklets!) {
    try {
      // as: JSON cross-boundary — shape checked at enqueue (WorkletCtx + assertCrossableValue params)
      globalThis.lynxWorkletImpl._runRunOnMainThreadTask(
        w.worklet as never,
        w.params as never,
        w.resolveId,
      )
    }
    catch (e) {
      // Same isolation as applyOps per-op: one throwing worklet must not
      // drop the rest of the batch (mirrors official updateMainThread).
      console.log('[lynx-solid] runOnMainThread worklet failed:', e)
    }
  }
  if (ops.length > 0)
    __FlushElementTree()
}
