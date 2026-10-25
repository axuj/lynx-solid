/* raw-lynx: hand-wired dual-thread bundle with zero framework code.
 * Mirrors the entry assembly in lynx-solid's plugin (entries with layers,
 * MarkMainThread asset flag, template + wrapper + encode plugins) minus
 * everything framework-shaped (no loaders, no skeletons, no worklets).
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { RuntimeWrapperWebpackPlugin } from '@lynx-js/runtime-wrapper-webpack-plugin'
import { LynxEncodePlugin, LynxTemplatePlugin } from '@lynx-js/template-webpack-plugin'
import { defineConfig } from '@rsbuild/core'

const MT_FILENAMES = ['.rspeedy/raw/main-thread.js']

// MT entry worklet runtime — the official `@lynx-js/react/worklet-runtime`
// subpath, resolved from the workspace root (same approach as the plugin's
// entries) so the config survives reinstalls; the previous hardcoded store
// path broke on every react upgrade.
const require = createRequire(import.meta.url)
const WORKLET_RUNTIME = require.resolve('@lynx-js/react/worklet-runtime')

class MarkMT {
  apply(compiler: any): void {
    const { RuntimeGlobals } = compiler.webpack
    compiler.hooks.thisCompilation.tap('raw-mark-mt', (compilation: any) => {
      compilation.hooks.additionalTreeRuntimeRequirements.tap('raw-mark-mt', (chunk: any, set: any) => {
        const opts = chunk.getEntryOptions && chunk.getEntryOptions()
        if (opts && opts.layer === 'raw:main-thread') {
          set.add(RuntimeGlobals.startup)
          set.add(RuntimeGlobals.require)
        }
      })
      compilation.hooks.processAssets.tap(
        {
          name: 'raw-mark-mt',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          for (const f of MT_FILENAMES) {
            const asset = compilation.getAsset(f)
            if (asset) {
              compilation.updateAsset(f, asset.source, {
                ...asset.info,
                'lynx:main-thread': true,
              })
            }
          }
        },
      )
    })
  }
}

function rawLynx() {
  return {
    name: 'raw-lynx',
    setup(api: any) {
      api.modifyBundlerChain((chain: any, { environment }: any) => {
        const name = environment.name || ''
        const isLynx = name === 'lynx' || name.startsWith('lynx-')
        if (!isLynx)
          return
        chain.entryPoints.clear()
        const srcDir = path.join(process.cwd(), 'src')
        chain
          .entry('raw__main-thread')
          .add({
            layer: 'raw:main-thread',
            import: [
              path.join(srcDir, 'mt-bootstrap.js'),
              WORKLET_RUNTIME,
              path.join(srcDir, 'mt.js'),
            ],
            filename: '.rspeedy/raw/main-thread.js',
          })
          .end()
        chain
          .entry('raw')
          .add({
            layer: 'raw:background',
            import: [path.join(srcDir, 'bg.js')],
            filename: '.rspeedy/raw/background.js',
          })
          .end()
        chain.plugin('raw-mark-mt').use(MarkMT, [MT_FILENAMES]).end()
        chain
          .plugin('raw-template')
          .use(LynxTemplatePlugin, [{
            ...LynxTemplatePlugin.defaultOptions,
            chunks: ['raw__main-thread', 'raw'],
            filename: 'raw.lynx.bundle',
            intermediate: '.rspeedy/raw',
            // CSS selector / invalidation flags (explicit so defaults stay stable)
            debugInfoOutside: true,
            enableCSSSelector: true,
            enableCSSInvalidation: true,
            enableRemoveCSSScope: false,
            removeDescendantSelectorScope: true,
          }])
          .end()
        chain
          .plugin('raw-wrapper')
          .use(RuntimeWrapperWebpackPlugin, [{
            test: /^(?!.*main-thread(?:\.[A-Fa-f0-9]*)?\.js$).*\.js$/,
          }])
          .end()
        chain.plugin('raw-encode').use(LynxEncodePlugin, [{}]).end()
        chain.output.set('iife', false)
      })
    },
  }
}

export default defineConfig({
  environments: { lynx: {} },
  source: {
    entry: {
      raw: './src/bg.js',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4010,
  },
  output: {
    distPath: { root: 'dist' },
    // `pluginLynx` normally supplies these via `pluginMinify`; this demo is
    // hand-wired and skips it, so rsbuild's default compressor folds the
    // runtime wrapper's `if (bundleSupportLoadScript) … return {init}` into a
    // ternary and drops the return. `loadScript` then hands the engine no
    // `init` and every launch dies with `loadCard failed … load failed`.
    // Keep the same compressor settings pluginLynx's `pluginMinify` uses;
    // `negate_iife` and `comparisons` are the two that preserve the wrapper's
    // `if (...) return {init}`.
    minify: {
      jsOptions: {
        minimizerOptions: {
          compress: {
            negate_iife: false,
            join_vars: false,
            ecma: 2015,
            inline: 2,
            comparisons: false,
            toplevel: true,
            side_effects: false,
          },
          format: { keep_quoted_props: true, comments: false },
          mangle: { toplevel: true },
        },
      },
    },
  },
  plugins: [rawLynx()],
})
