/**
 * Global `queueMicrotask` guard — the whole of this repo's polyfill story
 * (no core-js ships in any bundle anymore).
 *
 * Baseline: the device runtime (PrimJS) provides ≈ ES2020 built-ins natively
 * (official docs list flat/flatMap/includes/entries/values/padStart/padEnd
 * as available; the real gaps are Object.hasOwn / Array.at / replaceAll —
 * ES2021+, all three un-writable now that `packages/runtime/tsconfig.json`
 * pins `lib: ES2020`, and none of them was ever called here anyway). The one
 * gap a bare global fills is `queueMicrotask` — a WHATWG HTML API that no
 * ECMAScript edition defines. Whether a JS context has it is per thread: on
 * device the BG has none, the MT ships one. So this module installs a global
 * only where one is missing, preferring the engine's `lynx.queueMicrotask` and
 * falling back to a Promise turn.
 *
 * Why the runtime owns this one and nothing else: solid's own mount path
 * calls the **bare** identifier (`onHydrationEnd` → `queueMicrotask` on every
 * render; `solid-js/dist/solid.js:66-71`), so without it every Solid app dies
 * at first render on device with `queueMicrotask is not defined` — measured
 * on a counter example. It is not a BOM alias: nothing probes
 * it to decide "am I a browser". Every other host surface (self/window/URL/
 * AbortController/…) stays app-owned in `polyfills.ts`, and the runtime's own
 * code does not depend on this global — `internal/microtask.ts` talks to the
 * engine directly.
 *
 * Only the BG installs it: the MT's JS context provides `queueMicrotask` itself,
 * and a non-IFR MT evaluates no app code anyway. Import order is load-bearing —
 * first import of background/bootstrap.ts (every BG entry, which the plugin
 * prepends).
 */
const hasNative = typeof Reflect.get(globalThis, 'queueMicrotask') === 'function'

if (!hasNative) {
  Reflect.set(globalThis, 'queueMicrotask', (callback: () => void): void => {
    const engine = typeof lynx !== 'undefined' ? lynx : undefined
    if (engine && typeof engine.queueMicrotask === 'function') {
      engine.queueMicrotask(callback)
      return
    }
    // Last resort. Note `lynx` here is the BARE identifier: on the BG it is a
    // RuntimeWrapperWebpackPlugin parameter, and `globalThis.lynx` does not exist
    // — never rewrite this read as `globalThis.lynx`. Never treat Promise as the
    // microtask primitive either: on device it is a JS polyfill whose second
    // `.then` slips past a `setTimeout(0)`.
    Promise.resolve().then(callback)
  })
}

export {}
