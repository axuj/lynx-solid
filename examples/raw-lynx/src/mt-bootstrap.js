/* eslint-disable no-var, no-undef */
/* MT bootstrap: globals the worklet-runtime IIFE reads at load time.
 * Mirrors the MT bootstrap of vue-lynx (https://github.com/Huxpro/vue-lynx,
 * Apache-2.0) — SystemInfo with a `{}` fallback. Must execute BEFORE the
 * worklet IIFE or MT dies with `SystemInfo is not defined` and nothing after
 * it (renderPage/processData/updatePage) ever runs. */
var g = globalThis
var _s = (typeof lynx !== 'undefined' && lynx.SystemInfo) || g.SystemInfo || {}
g.SystemInfo = _s
