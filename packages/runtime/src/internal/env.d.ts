/**
 * Engine environment surface, mounted onto the global scope (TS handbook
 * "Global-Modifying Module" template: module file + declare-global).
 *
 * Shapes are indexed off the official interfaces — upstream signature changes
 * follow automatically. Timers are two-arg only: BG js_app.cc / MT
 * napi_lepus_lynx.cc drop forwarded args and fire the callback zero-arg.
 * (@lynx-js/types declares the same signatures in common/global.d.ts but
 * OUTSIDE its declare-global block — module-scoped dead code.)
 */
import type { Console, LynxComponentRuntimeMethod } from '@lynx-js/types'

declare global {
  const setTimeout: LynxComponentRuntimeMethod['setTimeout']
  const setInterval: LynxComponentRuntimeMethod['setInterval']
  const clearTimeout: LynxComponentRuntimeMethod['clearTimeout']
  const clearInterval: LynxComponentRuntimeMethod['clearInterval']

  /** Shape owned by @lynx-js/types — do not extend here. */
  const console: Console

  // Native on web/tests; on the BG the runtime installs a guard for it
  // (internal/queue-microtask-shim.ts), on the MT the context provides its own.
  // The runtime's own scheduling does not use this global — internal/microtask.ts
  // talks to the engine directly.
  function queueMicrotask(callback: () => void): void

  // Web hosts only — absent on device (ops-log guards with typeof). The
  // Node-side tsconfig program resolves this name from @types/node instead;
  // this file is not part of that program.
  interface BroadcastChannelInstance {
    postMessage: (data: unknown) => void
  }
  const BroadcastChannel: new (name: string) => BroadcastChannelInstance
}

export {}
