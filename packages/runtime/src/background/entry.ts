/**
 * Background Thread bootstrap entry.
 *
 * Pure wiring, no rendering (that is render()'s job). Installs:
 *   1. The event bridge — engine-dispatched events arrive as calls on the
 *      `tt` object inside lynxCoreInject (an AMD callback parameter, visible
 *      as a bare identifier, NOT on globalThis). All three entry points are
 *      routed into the sign registry's publishEvent; the componentId of
 *      publicComponentEvent is discarded.
 *   2. The ops transport — drained batches go to the Main Thread via
 *      lynx.getNativeApp().callLepusMethod('lynxSolidApplyOps', ...). The
 *      method name is the contract with the Main Thread side (P7).
 *   3. Environment stubs required by the Lepus runtime (updatePage).
 *
 * initBackground() is invoked by the bundler plugin (pluginSolidLynx
 * prepends ./bootstrap.ts — a top-level-side-effect module, vue-lynx's
 * entry-background model) to every background entry. It stays an explicit
 * function so tests can wire a fake tt instead of the real one.
 */

import type { PendingWorklet } from './flush'
import { callLepusMethod } from './cross-thread'
import { publishEvent as registryPublish } from './event-registry'
import { getOpsExecutor, setOpsExecutor } from './flush'

// lynxCoreInject is injected by RuntimeWrapperWebpackPlugin as a parameter of
// the outer __init_card_bundle__ AMD callback — bare identifier, no import.
// eslint-disable-next-line no-var
declare var lynxCoreInject:
  | {
    tt?: {
      publishEvent?: (sign: string, data: unknown) => void
      publicComponentEvent?: (
        cid: string,
        sign: string,
        data: unknown,
      ) => void
      [key: string]: unknown
    }
  }
  | null
  | undefined

// Same injection story for `lynx` lives in cross-thread.ts (the only module
// that touches the native app).

/** The BG→MT method name; the Main Thread registers it (P7). */
export const APPLY_OPS_METHOD = 'lynxSolidApplyOps'

export interface TtBridge {
  publishEvent?: (sign: string, data: unknown) => void
  publicComponentEvent?: (cid: string, sign: string, data: unknown) => void
}

/**
 * Route every engine event entry point into the sign registry. `cid` carries
 * component-scoped routing for the engine — irrelevant to our flat registry.
 */
export function installBridge(tt: TtBridge | null | undefined): void {
  if (tt) {
    tt.publishEvent = registryPublish
    tt.publicComponentEvent = (_cid: string, sign: string, data: unknown) => {
      registryPublish(sign, data)
    }
  }
  // Legacy SDKs call a plain global instead of tt.publishEvent.
  globalThis.publishEvent = registryPublish
}

/**
 * Default transport: ship a batch to the Main Thread as JSON.
 * `worklets` (pending runOnMainThread dispatches) rides the same
 * `callLepusMethod` so the MT can applyOps before running them.
 */
function sendOpsToMainThread(ops: unknown[], worklets?: PendingWorklet[]): void {
  const payload: { data: string, worklets?: string } = {
    data: JSON.stringify(ops),
  }
  if (worklets && worklets.length > 0)
    payload.worklets = JSON.stringify(worklets)
  callLepusMethod(APPLY_OPS_METHOD, payload)
}

/**
 * Wire everything: event bridge (from the real lynxCoreInject), default ops
 * transport (only if the caller did not already inject one), env stubs.
 */
export function initBackground(): void {
  const tt
    = typeof lynxCoreInject !== 'undefined' && lynxCoreInject
      ? lynxCoreInject.tt
      : undefined
  installBridge(tt)
  if (!getOpsExecutor()) {
    setOpsExecutor(sendOpsToMainThread)
  }
  // The Lepus runtime requires updatePage to exist; reactivity handles all
  // updates so this is a no-op.
  globalThis.updatePage = function (_data: unknown): void {}
}
