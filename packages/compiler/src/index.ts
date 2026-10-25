// Relative specifiers keep their `.js` extension: `tsc -b` copies them verbatim
// into dist/, and the package is loaded by plain Node (ESM) from the build
// config — extensionless fails with ERR_MODULE_NOT_FOUND at config load.
// `nub run` cannot catch that: its preload resolves workspace packages to `src`,
// so every nub build and every vitest run passes while `rsbuild build`
// fails. Value specifiers need it; type-only ones are erased either way (kept
// for uniformity).
export * from './dom-compile.js'
export type {
  LynxExtractedTemplate,
  WorkletRecord,
} from './types.js'
export * from './worklet-utils.js'
