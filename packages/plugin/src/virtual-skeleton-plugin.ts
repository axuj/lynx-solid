/**
 * virtual-skeleton-plugin — serves the MT-side skeleton module as an
 * rspack-native virtual module instead of writing it to disk.
 *
 * Background: the old pipeline wrote the skeleton module to disk on every
 * compile (index.ts pre-generation + skeleton-loader), putting files inside
 * the watched project root and feeding an unbounded rebuild loop that hung
 * on-demand bundle requests. Virtual modules remove the disk I/O entirely;
 * paths now live under `node_modules/` (see VIRTUAL_SKELETON_DIR in
 * index.ts), which is outside the watcher's normal scope, so the synthetic
 * `change` events `writeModule` emits never re-enter the rebuild loop —
 * exactly the trick unplugin's rspack adapter relies on for watching. No
 * watchOptions wiring is needed on either side.
 *
 * Content is (re)generated each time the skeleton module spec is resolved:
 * the fork-dom compile is shared through compileDomModuleCached, so the
 * skeleton tracks JSX edits on every watch rebuild. Hooking
 * `normalModuleFactory.hooks.resolve` mirrors unplugin's rspack adapter —
 * the virtual file store is not initialized before the compilation is
 * created, which is exactly why a `beforeCompile` write fails.
 */

import type { Compiler } from '@rspack/core'
import { readFileSync } from 'node:fs'
import { compileDomModuleCached } from '@lynx-solid/compiler'
import { renderSkeletonModuleLynx } from './skeleton-loader'

export const VIRTUAL_SKELETON_PLUGIN = 'lynx:solid-virtual-skeleton'

export interface VirtualSkeletonTarget {
  entryName: string
  /** Absolute path to the entry source module. */
  entrySrc: string
  /** Context-relative posix spec, e.g. `node_modules/.lynx-solid/skeletons/elk.ts`. */
  skeletonSpec: string
  /** Relative import to the skeleton-registry module, from `node_modules/.lynx-solid/skeletons/`. */
  registryModule: string
}

/** Normalize a request for spec comparison: `./x` → `x`, windows-agnostic. */
function normalizeSpec(spec: string): string {
  return spec.replaceAll('\\', '/').replace(/^\.?\//, '')
}

export class VirtualSkeletonPlugin {
  constructor(private readonly targets: readonly VirtualSkeletonTarget[]) {}

  apply(compiler: Compiler): void {
    const VirtualModules = compiler.rspack.experiments.VirtualModulesPlugin
    if (!VirtualModules) {
      console.warn(
        `[pluginSolidLynx] rspack experiments.VirtualModulesPlugin is `
        + 'unavailable; skeleton modules will not be emitted.',
      )
      return
    }
    const vfs = new VirtualModules()
    vfs.apply(compiler)

    compiler.hooks.compilation.tap(
      VIRTUAL_SKELETON_PLUGIN,
      (_compilation, { normalModuleFactory }) => {
        normalModuleFactory.hooks.resolve.tapPromise(
          VIRTUAL_SKELETON_PLUGIN,
          async (resolveData) => {
            const target = this.targets.find(
              t => normalizeSpec(resolveData.request) === t.skeletonSpec,
            )
            if (!target)
              return
            // Sync regeneration is cheap (shared compile cache); writing
            // here — before the normal factory reads the module — keeps
            // skeleton content fresh per resolve, including watch rebuilds.
            const source = renderSkeletonModuleLynx(
              compileDomModuleCached(
                readFileSync(target.entrySrc, 'utf8'),
                { filename: target.entrySrc },
              ).templates,
              target.registryModule,
            )
            vfs.writeModule(target.skeletonSpec, source)
          },
        )
      },
    )
  }
}
