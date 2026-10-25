/**
 * Compile-time DEV flag.
 *
 * The build plugin (`packages/plugin/src/index.ts`) injects it via rspack
 * DefinePlugin as `!isProd` for the lynx + web environments, so release
 * bundles fold every `__DEV__` branch away (mirrors ReactLynx
 * ElementTemplate `__DEV__` DEV-throw / PROD-strip).
 *
 * Always read it through `typeof __DEV__ !== 'undefined' && __DEV__`:
 * unit tests (vitest, no DefinePlugin) and prebuilt dist consumed without
 * our plugin then fall back to production behavior instead of throwing
 * ReferenceError. Tests flip the flag per case with
 * `vi.stubGlobal('__DEV__', ...)` — no globalThis casts.
 */
declare const __DEV__: boolean
