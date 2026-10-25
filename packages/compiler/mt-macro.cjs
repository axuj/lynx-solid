/**
 * Official built-in macro pass for the MT shared re-emit chain.
 *
 * Shared modules reach the main thread via
 * `!!<this-loader>!builtin:swc-loader!<path>` — loaders run right-to-left,
 * so builtin transpiles TS first (right) and this runs second (left) on the
 * JS output. Every OTHER loader is bypassed on this path, so without this
 * pass the Lynx built-in macros (`__MAIN_THREAD__`, `__BACKGROUND__`,
 * deprecated aliases `__LEPUS__`/`__JS__`) stay free identifiers in MT
 * copies of shared modules — undefined at device eval, which skips e.g.
 * motion's shim gate and crashes with `queueMicrotask is not defined`.
 *
 * The processing itself is 100% the OFFICIAL `@lynx-js/react` transform
 * (same `defineDCE` map shape as its `defines.spec.js`: per-target
 * `String(target === 'LEPUS')`); this file only invokes it — no custom
 * substitution logic. See lynx-website api/react/Document.built-in-macros:
 * macros are compile-time, false branches removed.
 */
'use strict'

const { transformReactLynxSync } = require('@lynx-js/react/transform')

// Prefilter: skip node_modules / files without any macro (motion-dom etc.).
const MACROS = /__MAIN_THREAD__|__BACKGROUND__|__LEPUS__|__JS__/

module.exports = function mtMacroLoader(source) {
  if (typeof source !== 'string' || !MACROS.test(source))
    return source

  const result = transformReactLynxSync(source, {
    pluginName: 'lynx-solid:mt-macro',
    mode: 'production',
    filename: this.resourcePath,
    sourcemap: false,
    cssScope: false,
    snapshot: false,
    shake: false,
    compat: false,
    refresh: false,
    // MT-side chain: this loader only ever runs on main-thread copies.
    // Mirrors @lynx-js/react transform defines.spec per-target map.
    defineDCE: {
      define: {
        __LEPUS__: 'true',
        __MAIN_THREAD__: 'true',
        __JS__: 'false',
        __BACKGROUND__: 'false',
      },
    },
    directiveDCE: false,
    worklet: false,
  })

  if (result.errors?.length) {
    for (const err of result.errors)
      this.emitError(new Error(`[mt-macro-loader] ${err.text ?? String(err)}`))
  }
  return typeof result.code === 'string' && result.code.length > 0
    ? result.code
    : source
}
