/**
 * Host gap for browser-shaped libraries — here `@tanstack/solid-query`.
 *
 * TanStack detects the environment with `typeof window === 'undefined'`. On the
 * background thread that name is a `RuntimeWrapperWebpackPlugin` parameter
 * (undefined on device), so the library took its **SSR path**: it never
 * subscribed to the cache, and an optimistic `setQueryData` write never
 * reached the UI (measured on device: the cache held 9 rows while the view
 * still rendered 10).
 *
 * Background only — `__MAIN_THREAD__` folds this block out of the main-thread
 * copy. The MT is where MT-IFR paints the first screen, and it must keep the
 * server path: with `window` present the query observer attaches during that
 * render and tries to fetch, while the MT has neither `fetch` nor
 * `AbortController` (query-core builds one per Query instance,
 * `query.js:211`) — the attempt dies and the rejection is swallowed. That is
 * also why the runtime installs no browser-shaped globals at all: this file,
 * not the runtime, is where a host gap gets filled.
 *
 * The global alone is not enough — the bare `window` identifier inside bundle
 * code resolves to the wrapper parameter, so the wrapper-scope binding has to
 * be synced too (same trick as elk's `self` sync).
 *
 * Scope: this makes the background thread *look* like a browser to a library
 * that probes `typeof window`. It is NOT a DOM: `window.document` stays
 * undefined, so code that touches DOM APIs still fails.
 *
 * Deliberately NOT here: `AbortController` / `AbortSignal` — the background
 * thread has them natively (PrimJS).
 */
if (!__MAIN_THREAD__) {
  // The global property. A computed key never picks up the DOM `Window` type, so
  // this needs no cast: the value is the global object itself, the same shape a
  // browser has (`window === globalThis`).
  if (!('window' in globalThis)) {
    Object.defineProperty(globalThis, 'window', {
      value: globalThis,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  // The wrapper-scope binding. The bare `window` inside bundle code resolves to
  // the RuntimeWrapperWebpackPlugin parameter (undefined on device), so the
  // global property above stays invisible to the library's `typeof window`
  // probe — this rebinds the parameter itself (same trick as elk's `self` sync).
  if (typeof window === 'undefined') {
    // eslint-disable-next-line no-global-assign -- deliberate scope sync
    window = globalThis as unknown as Window & typeof globalThis
  }
}
