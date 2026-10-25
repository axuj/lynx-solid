/**
 * IFR runtime aliases: which files the Main Thread graph must resolve
 * `@lynx-solid/runtime…` specifiers to when `enableMtIfr` is on.
 *
 * Every IFR-related module has to come from ONE build tree. rspack treats
 * `src/main-thread/ifr.ts` and `dist/main-thread/ifr.js` as two different
 * modules, so a mixed graph silently instantiates the whole runtime twice:
 * `runIfrMount` swaps the ops sink and writes `phase` in one copy while the
 * app's own emitters — reached through the compiler-emitted
 * `@lynx-solid/runtime/lynx-template` subpath — write into the other. Nothing
 * throws. The MT renders a full first screen into a buffer nobody reads, the
 * recording keeps one stray frame, every reconcile diverges, and the first
 * screen is torn down and replayed from the Background (measured on device:
 * `ifr.render ops:4 inst:0` + `reconcile diverge`).
 *
 * The bare specifier is aliased by the plugin; the subpath is NOT, so it would
 * otherwise answer from the package exports map — which may be the other tree.
 * Hence both entries are derived from the same resolved `ifr-runtime` here.
 *
 * Device attestation of the pin, same build config, before → after:
 *
 *   [tpl] instantiate … sink=i8p6ma        ← app writes into copy A
 *   [ifr] after-flush ops=4 sink=lk7vb6    ← IFR swapped the sink in copy B
 *
 *   ifr.render {ops:29048, inst:1001}      ← one copy, one sink
 *   ifr.reconcile {branch: "match", ops: 29048}
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

/** Specifier the fork dom compiler emits for the template helpers. */
export const TEMPLATE_SPECIFIER = '@lynx-solid/runtime/lynx-template'

/** Specifier the MT entry imports the runtime through. */
export const RUNTIME_SPECIFIER = '@lynx-solid/runtime'

/**
 * Locate `ifr-runtime` NEXT TO the MT entry, not through the exports map.
 *
 * These two must come from the same tree. Resolving them independently lets a
 * dev build pair the src entry with a dist `ifr-runtime` (the repo tsconfig
 * `paths` send runtime specifiers to the package's `src` tree, while
 * `require.resolve` answers from `dist/`), and the MT bundle then ends up with
 * TWO copies of the whole runtime. IFR dies silently: `runIfrMount` writes
 * `phase` into one instance while `interceptBgOps` reads the other, which still
 * says `inactive`. Nothing throws; the MT just waits for the BG exactly as a
 * non-IFR build does. The dev-server log says it outright — `building
 * dist/main-thread/ifr.js` and `building src/main-thread/ifr.ts` in the same
 * breath.
 */
export function resolveIfrRuntime(mainThreadEntry: string): string {
  const dir = path.dirname(mainThreadEntry)
  // The entry is `.ts` in dev/source mode and `.js` against dist.
  for (const file of ['ifr-runtime.js', 'ifr-runtime.ts']) {
    const candidate = path.join(dir, file)
    if (existsSync(candidate))
      return candidate
  }
  return createRequire(import.meta.url).resolve('@lynx-solid/runtime/ifr-runtime')
}

/**
 * A runtime file NEXT TO the resolved `ifr-runtime`, i.e. in the same build
 * tree, and therefore an instance of the same modules.
 */
export function resolveRuntimeTreeFile(ifrRuntime: string, relative: string): string {
  const treeRoot = path.dirname(path.dirname(ifrRuntime))
  for (const ext of ['.js', '.ts']) {
    const candidate = path.join(treeRoot, `${relative}${ext}`)
    if (existsSync(candidate))
      return candidate
  }
  return path.join(treeRoot, `${relative}.js`)
}

/**
 * The `resolve.alias` entries for the Main Thread layer under `enableMtIfr`.
 *
 * Both entries share one build tree by construction — that is the contract the
 * caller (and `tests/compiler/ifr-runtime-alias.test.ts`) locks.
 */
export function ifrRuntimeAliases(mainThreadEntry: string): Record<string, string> {
  const ifrRuntime = resolveIfrRuntime(mainThreadEntry)
  return {
    [RUNTIME_SPECIFIER]: ifrRuntime,
    [TEMPLATE_SPECIFIER]: resolveRuntimeTreeFile(ifrRuntime, 'background/lynx-template'),
  }
}
