/**
 * Microtask scheduling for the runtime's own code.
 *
 * Internal code does not go through the global `queueMicrotask` guard: that
 * guard exists for the framework the runtime hosts (solid calls the bare
 * identifier on every mount — see internal/queue-microtask-shim.ts), whereas
 * the runtime's own scheduling can talk to the engine directly. Every other
 * host surface belongs to the app's `polyfills.ts` (docs/guide/mt-ifr.mdx,
 * rule 1). Engine fn where the host provides it, a Promise turn elsewhere
 * (web hosts, Node tests).
 */
export function scheduleMicrotask(callback: () => void): void {
  // The BARE `lynx`, never `globalThis.lynx`: on the BG there is no `lynx` on
  // `globalThis` at all — it arrives as a RuntimeWrapperWebpackPlugin parameter
  // (`defaultInjectVars`) and only that binding carries `queueMicrotask`
  // (measured on device). Also note `Promise` is a JS polyfill
  // on this engine whose second-level `.then` loses to `setTimeout(0)`, so the
  // fallback below is a last resort, not an equivalent microtask.
  const engine = typeof lynx === 'undefined' ? undefined : lynx
  if (engine && typeof engine.queueMicrotask === 'function') {
    engine.queueMicrotask(callback)
    return
  }
  // Same exception surface as queueMicrotask: a throwing callback rejects this
  // thenable, which the host reports as an unhandled rejection.
  Promise.resolve().then(callback)
}
