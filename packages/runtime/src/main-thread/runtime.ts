/**
 * MT-layer `@lynx-solid/runtime` surface for compiled worklet bodies.
 *
 * Worklet bodies run on the Main Thread but are compiled from modules that
 * import the (background) package entry — e.g. Sheet's `finishSettle`
 * calls `runOnBackground(closeRef)()`. `worklet-mt-loader` rewrites that
 * specifier to this module so the reference resolves to the MT factory
 * (`run-on-background-mt.ts`, zero imports, MT-safe) instead of the BG
 * entry's export, which is an empty shell in the MT bundle.
 *
 * NOTE: spelled as import + `export const` (not `export … from`) because
 * the fork dom compiler drops re-export statements in MT output while
 * keeping plain exported declarations (cf. gesture.ts).
 *
 * Only MT-safe bindings belong here. Anything else a worklet body needs
 * must come through `with { runtime: 'shared' }` imports (kept verbatim in
 * MT output) or MainThreadRef captures.
 */
import { runOnBackground as runOnBackgroundImpl } from './run-on-background-mt'

export const runOnBackground = runOnBackgroundImpl
export type { JsFnHandle } from './run-on-background-mt'
