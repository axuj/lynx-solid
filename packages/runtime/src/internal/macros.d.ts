/**
 * Lynx built-in compile-time macros.
 *
 * Not runtime globals: the compiler folds them away, so the false branch of
 * `if (__MAIN_THREAD__)` is removed from the bundle. The values are per copy —
 * the main-thread copy gets `true`, the background copy `false` — which lets an
 * app pick a different implementation per thread without a runtime probe (see
 * the router codec in `examples/elk/src/router.tsx`).
 *
 * The map mirrors the official `@lynx-js/react` transform's per-target defines
 * (`String(target === 'LEPUS')`): the main-thread copy is compiled with the
 * LEPUS target, the background copy with the JS target.
 *
 * A separate file from `env.d.ts` (runtime globals) and `globals.d.ts` (globals
 * the runtime installs): these names never exist at runtime, so putting them
 * next to the real globals would invite `typeof` guards that are not needed.
 */

declare global {
  /** True only in the main-thread (LEPUS) copy of a module. */
  const __MAIN_THREAD__: boolean
  /** True only in the background (JS) copy of a module. */
  const __BACKGROUND__: boolean
  /** Deprecated alias of `__MAIN_THREAD__`. */
  const __LEPUS__: boolean
  /** Deprecated alias of `__BACKGROUND__`. */
  const __JS__: boolean
}

export {}
