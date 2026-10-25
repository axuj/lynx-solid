/**
 * Webpack compilation hooks shared with the Lynx template pipeline.
 *
 * Ported from the equivalent plugins in vue-lynx
 * (https://github.com/Huxpro/vue-lynx — Apache-2.0, same author), keeping the
 * same `test:` regex and `lynx:main-thread` asset flag. Kept in sync
 * intentionally; the long-term plan is to delegate marking to
 * `ReactWebpackPlugin` in ReactLynx (https://github.com/lynx-family/lynx-stack,
 * Apache-2.0).
 */

import type { Compiler } from '@rspack/core'
import { LynxTemplatePlugin } from '@lynx-js/template-webpack-plugin'

/** Webpack module layers separating the dual-thread bundles. */
export const LAYERS = {
  BACKGROUND: 'solid:background',
  MAIN_THREAD: 'solid:main-thread',
  /**
   * Modules on the shared MT pipeline: entered through a root edge marked
   * `with { runtime: 'shared' }`, cascaded to every module they import
   * (rule.layer marks the matched target; issuerLayer picks the cascade
   * back up on its own imports). Never carries source rewrites — the
   * closure is pure module-graph state.
   */
  SHARED: 'solid:shared',
} as const

export const PLUGIN_MARK_MAIN_THREAD = 'lynx:solid-mark-main-thread'
export const PLUGIN_CSS_CONFIG = 'lynx:solid-css-config'

/**
 * Minimal typing for a webpack Chunk (avoids importing @rspack/core).
 */
export interface WebpackChunk {
  getEntryOptions: () => { layer?: string } | undefined
}

/**
 * Minimal typing for the webpack Compilation object.
 */
export interface WebpackCompilation {
  hooks: {
    processAssets: {
      tap: (options: { name: string, stage: number }, callback: () => void) => void
    }
    additionalTreeRuntimeRequirements: {
      tap: (
        name: string,
        callback: (chunk: WebpackChunk, set: Set<string>) => void,
      ) => void
    }
  }
  getAsset: (
    filename: string,
  ) => { source: unknown, info: Record<string, unknown> } | undefined
  updateAsset: (
    filename: string,
    source: unknown,
    info: Record<string, unknown>,
  ) => void
}

/**
 * Minimal typing for the webpack Compiler object.
 */
export interface WebpackCompiler {
  webpack: {
    Compilation: {
      PROCESS_ASSETS_STAGE_ADDITIONAL: number
      PROCESS_ASSETS_STAGE_PRE_PROCESS: number
    }
    RuntimeGlobals: { startup: string, require: string }
    sources: { RawSource: new (source: string) => unknown }
  }
  hooks: {
    thisCompilation: {
      tap: (
        name: string,
        callback: (compilation: WebpackCompilation) => void,
      ) => void
    }
  }
}

/**
 * Force webpack to generate startup code for MT entry chunks and mark the
 * main-thread asset with `lynx:main-thread: true` so LynxTemplatePlugin routes
 * it to lepusCode.root. Reason for the startup hack: the Lynx
 * engine sets `chunkLoading: 'lynx'` globally and StartupChunkDependenciesPlugin only
 * adds RuntimeGlobals.startup when the chunk has async dependencies; MT entries
 * usually don't, so without this the entry module factories never execute.
 */
export class MarkMainThreadPlugin {
  constructor(private readonly mainThreadFilenames: string[]) {}

  apply(compiler: WebpackCompiler): void {
    const { RuntimeGlobals } = compiler.webpack

    compiler.hooks.thisCompilation.tap(
      PLUGIN_MARK_MAIN_THREAD,
      (compilation) => {
        compilation.hooks.additionalTreeRuntimeRequirements.tap(
          PLUGIN_MARK_MAIN_THREAD,
          (chunk, set) => {
            const entryOptions = chunk.getEntryOptions()
            if (entryOptions?.layer === LAYERS.MAIN_THREAD) {
              set.add(RuntimeGlobals.startup)
              set.add(RuntimeGlobals.require)
            }
          },
        )

        compilation.hooks.processAssets.tap(
          {
            name: PLUGIN_MARK_MAIN_THREAD,
            stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
          },
          () => {
            for (const filename of this.mainThreadFilenames) {
              const asset = compilation.getAsset(filename)
              if (asset) {
                compilation.updateAsset(filename, asset.source, {
                  ...asset.info,
                  'lynx:main-thread': true,
                })
              }
            }
          },
        )
      },
    )
  }
}

/**
 * Inject engine compiler options into the encoded template's
 * sourceContent.config. These are read
 * by the engine at template load, but are NOT LynxTemplatePlugin options —
 * the only channel is the beforeEncode hook. The template hooks are stashed
 * per-compilation (shared by every per-entry LynxTemplatePlugin instance),
 * so one tap covers all entries.
 */
export class CSSConfigPlugin {
  constructor(private readonly compilerOptions: Record<string, unknown>) {}

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      PLUGIN_CSS_CONFIG,
      (compilation) => {
        const hooks = LynxTemplatePlugin.getLynxTemplatePluginHooks(compilation)
        hooks.beforeEncode.tap(PLUGIN_CSS_CONFIG, (args) => {
          Object.assign(args.encodeData.sourceContent.config, this.compilerOptions)
          return args
        })
      },
    )
  }
}
