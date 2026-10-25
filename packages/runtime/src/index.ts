/**
 * @lynx-solid/runtime — public entry.
 *
 * Tree mounting API (render) and the dual-thread bridge only — reactivity
 * comes from `solid-js` directly. `initBackground` is auto-invoked by
 * `background/bootstrap.ts` (prepended by pluginSolidLynx).
 */
// First import: the queueMicrotask guard (see internal/queue-microtask-shim for
// why this is the runtime's only global). Bootstrap entries install it even
// earlier; this edge keeps direct entry consumers covered too.
import './internal/queue-microtask-shim'

export { registerBgFunction, transformToWorklet } from './background/bg-function-registry'
export { APPLY_OPS_METHOD, initBackground } from './background/entry'
export { ref } from './background/lynx-template'
export { MainThreadRef, useMainThreadRef } from './background/main-thread-ref'
export { Page } from './background/page'
export { createPageRoot, render, renderer } from './background/renderer'
export { runOnBackground, runOnMainThread } from './background/run-on-background'
