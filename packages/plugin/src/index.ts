/**
 * pluginSolidLynx — rsbuild plugin for @lynx-solid/runtime.
 *
 * Built for Rsbuild (the Rspeedy CLI is gone from this repo): it registers the
 * Lynx build engine (`pluginLynx`) itself when the config does not, which is
 * what makes `plugins: [pluginSolidLynx()]` enough in `rsbuild.config.ts`.
 *
 * Mirrors the approach used by vue-lynx (https://github.com/Huxpro/vue-lynx)
 * and ReactLynx (https://github.com/lynx-family/lynx-stack), both Apache-2.0,
 * cut down to what the MVP needs and wired to our own module layout:
 *
 *   - Splits each user entry into a background entry (Solid runtime + user
 *     code) and a main-thread entry (src/main-thread/index.ts, the PAPI
 *     bootstrap), using webpack layers so both bundles stay separate.
 *   - Prepends src/background/bootstrap.ts to every background entry — it
 *     calls initBackground() at module load, so user entries never wire the
 *     bridge manually.
 *   - Marks the main-thread asset with `lynx:main-thread` so LynxTemplatePlugin
 *     routes it to lepusCode.root (Lepus code), and the background assets ride
 *     the manifest.
 *   - Wraps ONLY background JS with RuntimeWrapperWebpackPlugin so the `tt`
 *     injection (lynxCoreInject) reaches the Solid runtime without touching
 *     the main-thread bundle.
 *   - Injects engine compiler options (enableCSSInlineVariables) into the
 *     encoded template config via the beforeEncode hook.
 *   - lynx environment: LynxEncodePlugin (TASM). web environment:
 *     WebEncodePlugin (@lynx-js/web-core binary web bundle).
 */

import type { RsbuildPlugin, RsbuildPluginAPI } from '@rsbuild/core'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPluginLynxRegistered, pluginLynx } from '@lynx-js/rsbuild-plugin'
import { RuntimeWrapperWebpackPlugin } from '@lynx-js/runtime-wrapper-webpack-plugin'
import {
  LynxEncodePlugin,
  LynxTemplatePlugin,
  WebEncodePlugin,
} from '@lynx-js/template-webpack-plugin'
import { DefinePlugin } from '@rspack/core'
import { ifrRuntimeAliases, resolveIfrRuntime } from './ifr-alias'
import {
  CSSConfigPlugin,
  LAYERS,
  MarkMainThreadPlugin,
  PLUGIN_CSS_CONFIG,
  PLUGIN_MARK_MAIN_THREAD,
} from './lynx-template-hooks'
import {
  VIRTUAL_SKELETON_PLUGIN,
  VirtualSkeletonPlugin,
} from './virtual-skeleton-plugin'

export { LAYERS } from './lynx-template-hooks'

/**
 * Resolve a sibling loader module across both package layouts:
 * published (dist/index.js + dist/loaders/*.js) and
 * repo dev (src/index.ts next to the .ts loaders).
 */
function resolveLoader(name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(here, 'loaders', `${name}.js`),
    path.join(here, `${name}.ts`),
  ]
  for (const p of candidates) {
    if (existsSync(p))
      return p
  }
  throw new Error(`skeleton loader not found: ${name} (tried ${candidates.join(', ')})`)
}

/**
 * Default MT bootstrap / BG auto-init: resolved from the @lynx-solid/runtime
 * package through its exports map (`main-thread`, `bootstrap`) — version and
 * dist-layout agnostic. The `./package.json` export points at the package
 * root, which anchors the bootstrap-dir prefix matching below.
 */
function defaultMainThreadEntry(): string {
  return createRequire(import.meta.url).resolve('@lynx-solid/runtime/main-thread')
}

/**
 * MT-bootstrap modules that must never enter worklet-mt-loader.
 *
 * The MT entry (main-thread/index.ts) and its direct protocol deps
 * (internal/*) set up globalThis.renderPage/processData/etc.
 * and must execute as-is. Everything else — including the BG runtime entry
 * (packages/runtime/src/index.ts) and all of background/* — is user-side
 * from the MT loader's point of view and degrades to an import shell when it
 * carries no templates, worklets, or shared imports (non-IFR semantics: the
 * runtime is NOT excluded, otherwise the whole BG runtime would execute on
 * the MT).
 *
 * Paths are resolved, not matched as specifier strings: pnpm/nub symlinks
 * and workspace aliases resolve outside node_modules, so a `/node_modules/`
 * test alone is insufficient.
 * A function predicate (not a string prefix) is required — string RuleSet
 * conditions are not consistently treated as directory prefixes across
 * Rspack versions.
 */
const runtimeRoot = path.dirname(
  createRequire(import.meta.url).resolve('@lynx-solid/runtime/package.json'),
)
const bootstrapDirs = [
  // Source trees — the MT bootstrap modules regardless of how they are
  // materialized. rspack and the exports map may both surface these resources
  // (direct entry, tsconfig paths, symlinked workspaces), so prefix-match the
  // module trees, not a single artifact layout: dist mirrors the src subtrees
  // and the prefix covers both at once.
  path.resolve(runtimeRoot, 'src/main-thread'),
  path.resolve(runtimeRoot, 'src/internal'),
  // dist/main-thread + dist/internal — the single-tree tsc build
  // (tsconfig.build.json: src → dist 1:1) keeps the MT bootstrap and the
  // shared protocol layer at the same relative paths as src.
  path.resolve(runtimeRoot, 'dist/main-thread'),
  path.resolve(runtimeRoot, 'dist/internal'),
]
// NOTE: intentionally no existsSync filter — a candidate that does not exist
// on disk can never prefix-match a real resource, while filtering at module
// load would miss outputs built after the plugin was imported.
const normBootstrapDirs = bootstrapDirs.map(d =>
  d.replaceAll('\\', '/').toLowerCase().replace(/\/*$/, '/'),
)

const normIfrRuntimeDirs = [
  path.resolve(runtimeRoot, 'src/background'),
  path.resolve(runtimeRoot, 'dist/background'),
].map(d => d.replaceAll('\\', '/').toLowerCase().replace(/\/*$/, '/'))

/**
 * Runtime `background/` modules the MT must execute WHOLE under `enableMtIfr`
 * — the ShadowElement tree, node-ops, the lynx-template renderer, the page
 * wrapper. Normally they degrade to import shells on the MT (only their
 * `registerSkeleton` / `registerWorklet` output survives), which is correct for
 * the default shape where the MT never renders anything. IFR inverts that: the
 * MT runs the same renderer the BG does, so it needs the real modules.
 *
 * Deliberately NOT added to `bootstrapDirs` — that list is unconditional and
 * would pull the whole BG runtime into every MT bundle. This one is gated on the
 * opt-in flag.
 */
function isIfrRuntimeModule(resource: string): boolean {
  const clean = resource.split('!').pop()!.split('?')[0]!
  const r = `${path.resolve(clean).replaceAll('\\', '/').toLowerCase()}/`
  return normIfrRuntimeDirs.some(d => r.startsWith(d))
}

/**
 * Recursive copy, overwriting what is there. Used to stage package `dist`
 * trees outside node_modules so custom rspack rules can reach them (see the
 * MT-IFR one-shot build). Relative import specifiers inside the tree keep
 * working unchanged, which is why a whole tree is copied rather than a single
 * entry file.
 */
function copyDirSync(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory())
      copyDirSync(src, dst)
    else
      copyFileSync(src, dst)
  }
}

function isBootstrapModule(resource: string): boolean {
  const clean = resource.split('!').pop()!.split('?')[0]!
  const r = `${path.resolve(clean).replaceAll('\\', '/').toLowerCase()}/`
  return normBootstrapDirs.some(d => r.startsWith(d))
}

/**
 * Bundler chain types, extracted from the plugin API surface — @rsbuild/core
 * does not re-export RspackChain, so the chain type is derived from the
 * `modifyBundlerChain` callback instead of imported.
 */
type ModifyBundlerChainCallback = Extract<
  Parameters<RsbuildPluginAPI['modifyBundlerChain']>[0],
  (...args: any[]) => any
>
type BundlerChain = Parameters<ModifyBundlerChainCallback>[0]
type BundlerEntryPoint = NonNullable<
  ReturnType<BundlerChain['entryPoints']['entries']>
>[string]

/**
 * Whether this plugin is being driven by a build CLI. `rsbuild` is the only
 * one left in this repo; `rspeedy` is kept for consumers still on the old CLI
 * (both run the same engine, so the chain edits below apply identically).
 * Everything else — `rstest`, `rslib` — must keep the chain untouched.
 */
function isBuildCli(callerName: string): boolean {
  return callerName === 'rsbuild' || callerName === 'rspeedy'
}

const PLUGIN_TEMPLATE = 'lynx:solid-template'
const PLUGIN_DEV_FLAG = 'lynx:solid-dev-flag'
const PLUGIN_RUNTIME_WRAPPER = 'lynx:solid-runtime-wrapper'
const PLUGIN_ENCODE = 'lynx:solid-encode'
const PLUGIN_WEB_ENCODE = 'lynx:solid-web-encode'

const DEFAULT_INTERMEDIATE = '.rspeedy'

/**
 * `@solidjs/web/server-functions`, aliased to an inert stub on Lynx.
 *
 * Trailing `$` is webpack/rspack's exact-match convention: without it the key
 * also rewrites the `/server` and `/rich-args` subpaths (which the router's
 * type-only SSR imports reference) to `<stub>/server` and the build dies on a
 * missing file. `^…$` would be a LITERAL key (leading caret), matching
 * nothing — see the same trap documented at the IFR aliases below.
 */
const SERVER_FUNCTIONS_SPECIFIER = '@solidjs/web/server-functions$'

/**
 * Where each entry's skeleton module nominally lives. The path is purely
 * nominal — VirtualSkeletonPlugin serves it from rspack's in-memory virtual
 * file store, so nothing is ever written under it. It deliberately sits
 * under `node_modules/`: that directory is outside the watcher's normal
 * scope, which keeps the synthetic `change` events
 * `VirtualModulesPlugin.writeModule` emits for the virtual module from
 * re-entering the rebuild loop (the same trick unplugin's rspack adapter
 * uses for `node_modules/.virtual`). As a result neither the plugin nor the
 * consumer needs any watchOptions wiring.
 */
const VIRTUAL_SKELETON_DIR = 'node_modules/.lynx-solid/skeletons'

export interface SolidLynxPluginOptions {
  /**
   * Absolute path to the main-thread bootstrap module. Defaults to the
   * shipped dist bundle (dist/main-thread/index.js); repo dev
   * consumes dist too, so the default is the only path used.
   */
  mainThreadEntry?: string
  /**
   * Main-Thread IFR (Instant First Frame): the MT renders the first screen
   * itself during `renderPage`, instead of waiting for the background
   * bundle to boot and ship ops across the thread boundary.
   *
   * **Measured on device: NOT RECOMMENDED.** It works and is fully
   * opt-in, but the numbers say do not turn it on. Kept rather than deleted
   * only so the work is not lost; treat it as experimental.
   *
   *   - The MT runs PrimJS (a QuickJS fork: Lepus bytecode, no JIT); the BG
   *     runs V8. The same 1000-row first screen costs ~882ms of JS on the MT
   *     vs ~90ms on the BG — a structural ~10x no renderer work can fix.
   *   - So IFR's ceiling is the BG's post-bundle work (render + IPC): ~9ms out
   *     of a 160ms process-level cold start (5.6%). It wins only below ~10
   *     rows and then loses ~0.79ms per row.
   *   - V8's own cold init measures 4ms and runs concurrently with the bundle
   *     fetch, so "the MT does not wait for V8" saves nothing measurable.
   *   - ReactLynx, whose IFR is always on, hits the same wall (1378ms for
   *     1000 rows on the same device) — this is not a Solid-vs-React gap.
   *
   * Full data, the method, and the measurement traps we hit (milestone
   * semantics, bundle-download confound, warm starts) are documented in the
   * benchmark guide on the docs site.
   *
   * With this on, MT-layer user modules go through the FULL fork-dom compile
   * (same as BG) instead of worklet-mt-loader's import-shell degradation, so
   * the MT ends up holding the real component graph. `solid-js` then resolves
   * to the **server build** for MT modules only — a one-shot evaluator:
   * `createSignal` setters warn instead of mutating a graph,
   * `createRenderEffect` runs synchronously, no scheduler / graph / async.
   * That is exactly "render the first frame and throw the graph away".
   *
   * The BG resolves `solid-js` normally (client build), so both threads run
   * the same compiled artifact against the same `initData` and must emit an
   * identical ops stream — the alignment that makes reconciliation a no-op.
   * That equivalence is NOT free and is locked by
   * `tests/behavior/solid-build-id-align.test.ts`: Solid's server and client
   * builds allocate the same number of placeholder text nodes in a different
   * ORDER, so any id burned by an invisible node would shift every later id
   * and turn every first screen into a teardown+repaint. `ShadowElement`
   * therefore defers id assignment for empty `#text` (DEFERRED_ID).
   *
   * @defaultValue false
   */
  enableMtIfr?: boolean
  /**
   * Inject `enableCSSInlineVariables: true` into the encoded template's
   * sourceContent.config. Without it the Lynx engine resolves CSS custom
   * properties (var()) only against the first style pass — class-driven
   * theme overrides (.app-dark declaring --c-* vars) never re-cascade.
   * Lynx environment only; the web host uses native CSS and needs no flag.
   * @defaultValue false
   */
  enableCSSInlineVariables?: boolean
  /**
   * Whether to enable CSS inheritance in the Lynx engine. When enabled,
   * inheritable CSS properties (font-size, color, …) cascade parent → child
   * as on web; when disabled (default) they do not — matching ReactLynx.
   * CSS custom properties (`--*`) always inherit regardless of this flag.
   * Side effects when on: style-pass cost; `position:fixed` only inherits
   * from page; CSS keyword `inherit` unsupported.
   * @defaultValue false
   */
  enableCSSInheritance?: boolean
  /**
   * Custom inheritable CSS property list. When non-empty, **replaces** the
   * engine default inheritable set. Only effective when
   * {@link enableCSSInheritance} is `true`.
   * @defaultValue undefined
   */
  customCSSInheritanceList?: string[]
  /**
   * Allowlist of bare-import specifiers whose `'main thread'` worklets must
   * be followed into the MT module graph even though they resolve into
   * `node_modules`. Same semantics as vue-lynx's `includeWorkletPackages`.
   * @defaultValue []
   */
  includeWorkletPackages?: ReadonlyArray<string | RegExp>
}

interface SkeletonTarget {
  entryName: string
  entrySrc: string
  /** Posix-style `node_modules/.lynx-solid/skeletons/<entry>.ts` path, relative to root. */
  skeletonPath: string
  absSkeletonPath: string
  registryModule: string
}

/**
 * One skeleton target per (entry, source module) — shared by the setup
 * pre-generation above and the skeleton-loader rule options below.
 */
function collectSkeletonTargets(
  entries: Record<string, BundlerEntryPoint>,
  rootPath: string,
  registryModuleFrom: (fromDir: string) => string,
): SkeletonTarget[] {
  const targets: SkeletonTarget[] = []
  for (const [entryName, entryPoint] of Object.entries(entries)) {
    for (const val of collectEntryImports(entryPoint)) {
      const entrySrc = path.resolve(rootPath, val)
      const skeletonPath = path.posix.join(VIRTUAL_SKELETON_DIR, `${entryName}.ts`)
      const absSkeletonPath = path.resolve(rootPath, skeletonPath)
      targets.push({
        entryName,
        entrySrc,
        skeletonPath,
        absSkeletonPath,
        registryModule: registryModuleFrom(path.dirname(absSkeletonPath)),
      })
    }
  }
  return targets
}

/** Collect the source module specifiers of a chain entry point. */
function collectEntryImports(entryPoint: BundlerEntryPoint): string[] {
  const imports: string[] = []
  for (const val of entryPoint.values()) {
    if (typeof val === 'string')
      imports.push(val)
    else if (Array.isArray(val))
      imports.push(...val)
    else if (Array.isArray(val.import))
      imports.push(...val.import)
    else if (val.import)
      imports.push(val.import)
  }
  return imports
}

/**
 * Register the Lynx build engine (`pluginLynx`) when the config does not
 * already carry it.
 *
 * Rspeedy used to do this for every project it built; the plain Rsbuild CLI
 * knows nothing about Lynx, so a DSL plugin has to take over — the same
 * contract `pluginReactLynx` implements (`lynx:react:auto-lynx`): a project
 * lists only the DSL plugin and still gets the engine, with its defaults.
 *
 * `pluginLynx` returns several plugins instead of one, and a plugin that
 * declares an `apply` function has to be asked whether it wants to run at all,
 * so they are started by hand here — the same loop `pluginAutoLynx` uses.
 */
async function registerLynxEngine(api: RsbuildPluginAPI): Promise<void> {
  // rstest builds the config for unit tests; the engine's encode steps have
  // nothing to do there and would only slow the test run down.
  if (api.context.callerName === 'rstest')
    return
  const { environments } = api.getRsbuildConfig('original')
  if (isPluginLynxRegistered(api, Object.keys(environments ?? {})))
    return

  const { action } = api.context
  for (const plugin of pluginLynx()) {
    if (typeof plugin.apply === 'function') {
      // `apply` sees the ORIGINAL config (before any plugin processing), which
      // is what it decides on — a mutated one would report the wrong answer.
      const original = api.getRsbuildConfig('original')
      if (!plugin.apply(original, { action }))
        continue
    }
    await plugin.setup(api)
  }
}

export function pluginSolidLynx(options: SolidLynxPluginOptions = {}): RsbuildPlugin {
  const mainThreadEntry = options.mainThreadEntry ?? defaultMainThreadEntry()
  const cssConfigOptions: Record<string, unknown> = {}
  if (options.enableCSSInlineVariables)
    cssConfigOptions.enableCSSInlineVariables = true
  if (options.enableCSSInheritance)
    cssConfigOptions.enableCSSInheritance = true

  return {
    name: 'pluginSolidLynx',
    async setup(api) {
      // Engine first: it registers its own chain hooks (bundle encoding, chunk
      // loading, CSS extraction) and every edit below assumes they are there.
      await registerLynxEngine(api)

      // Lynx ships single-file packages: a split chunk would strand MT/BG
      // modules in files the template never loads (silent dead worklets).
      // Rspeedy defaulted `splitChunks` to false; a bare Rsbuild build splits
      // by module instead, so the default is restored here. The user's own
      // choice always wins — read from the ORIGINAL config, because by the time
      // this hook runs the engine/rsbuild has already put `{}` in `config`.
      api.modifyRsbuildConfig((config) => {
        const userConfig = api.getRsbuildConfig('original')
        if (userConfig.splitChunks !== undefined || userConfig.performance?.chunkSplit !== undefined)
          return
        config.splitChunks = false
      })

      // Warn once when the user opts out of the default all-in-one split
      // (mirrors lynx-stack's splitChunks guard in plugin-react entry).
      const chunkSplitStrategy = api.getRsbuildConfig()?.performance?.chunkSplit
      if (
        chunkSplitStrategy
        && chunkSplitStrategy.strategy
        && chunkSplitStrategy.strategy !== 'all-in-one'
      ) {
        console.warn(
          '[pluginSolidLynx] performance.chunkSplit is '
          + `'${chunkSplitStrategy.strategy}': Lynx bundles must stay single-file; `
          + 'async chunks will not be loaded by the template. '
          + 'Use \'all-in-one\' unless you know what you are doing.',
        )
      }

      // Root cause of `inset` collapse (top/left/right/bottom:0 → inset:0):
      // rsbuild defaults every environment to `output.target: 'web'`, so
      // browserslist is `chrome >= 107` (supports the inset shorthand) and
      // lightningcss-loader rewrites the four longhands to `inset`. Lynx's
      // CSS engine has no `inset` — the declaration is dropped and absolute
      // boxes collapse to height 0. lightningcss also emits `inset` when
      // `targets` is empty (modern-by-default), so pinning targets is not
      // enough for the minimizer either.
      //
      // Official (plugin-react / vue-lynx / pluginLynx) does NOT pin
      // chrome80 targets. It:
      //   1. deletes `builtin:lightningcss-loader` from the CSS rules
      //      (removeLightningCSS) so the loader stage never rewrites;
      //   2. registers cssnano via pluginCssMinimizer with
      //      `mergeLonghand: false` (replaces LightningCssMinimizer at
      //      CHAIN_ID.MINIMIZER.CSS) so the minimizer never creates
      //      `inset` either. pluginLynx's `minimizerOptions.targets: ''`
      //      only matters if LightningCssMinimizer still runs.
      //
      // Do not use overrideBrowserslist — that would downlevel JS too.
      api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) => {
        const lynxEnv = config.environments?.lynx
        if (!lynxEnv)
          return
        // Official path: never attach lightningcss-loader on lynx. rsbuild
        // only adds it when `tools.lightningcssLoader !== false` (626.js
        // updateRules). Belt-and-suspenders with removeLightningCSS below
        // (which still runs for sass/less/stylus rules and inline oneOfs
        // in case a future rsbuild adds the loader before this flag).
        return mergeRsbuildConfig(config, {
          environments: {
            lynx: {
              tools: {
                lightningcssLoader: false,
              },
            },
          },
        })
      })

      // Dev output goes to its own directory (`dist/` = build output only,
      // `dist-dev/` = dev server output). The engine makes `dev.writeToDisk`
      // default to true, so dev artifacts land in `dist/` — the same directory
      // the build uses — and every consumer of `dist/` has to police for them
      // (the docs' prepare step refuses to package a dev-form dist; the sweep
      // harness flags dev-form rows). Config level, not chain level: rsbuild
      // resolves the absolute output directory from the normalized config, so
      // `chain.output.set('distPath', …)` moves the asset sub-paths only.
      if (isBuildCli(api.context.callerName)) {
        api.modifyRsbuildConfig((config) => {
          // The CLI action, not `mode`: Rspeedy injected `mode` into the
          // config, a bare Rsbuild build leaves it undefined, and only a dev
          // server may write into `dist-dev/` (preview serves a real build).
          if (api.context.action !== 'dev')
            return
          const distPath = config.output?.distPath
          const root = typeof distPath === 'string' ? distPath : (distPath?.root ?? 'dist')
          config.output = {
            ...config.output,
            distPath: { ...(typeof distPath === 'object' ? distPath : {}), root: `${root}-dev` },
          }
        })
      }

      api.modifyBundlerChain((chain, { CHAIN_ID, environment, isProd }) => {
        const isLynxCli = isBuildCli(api.context.callerName)
        if (!isLynxCli)
          return

        const isLynx
          = environment.name === 'lynx' || environment.name.startsWith('lynx-')
        const isWeb
          = environment.name === 'web' || environment.name.startsWith('web-')
        if (!isLynx && !isWeb)
          return

        // Compile-time DEV flag for runtime DEV-only diagnostics (the
        // <list> child validation in node-ops mirrors ReactLynx
        // ElementTemplate: throw in DEV, stripped in PROD). Bundled code
        // reads it via `typeof __DEV__ !== 'undefined' && __DEV__` so unit
        // tests and plugin-less consumers fall back to PROD behavior.
        chain
          .plugin(PLUGIN_DEV_FLAG)
          .use(DefinePlugin, [{ __DEV__: JSON.stringify(!isProd) }])
          .end()

        // Solid JSX: every module goes through the fork dom pipeline
        // (skeleton-loader → compileDomModule) which emits
        // registerTemplate/insert/setAttribute calls against the
        // lynx-template runtime and per-template createCode for the MT
        // skeleton modules. The generated calls import
        // from `@lynx-solid/runtime`, so that alias must be set in the
        // rsbuild config (it is: rsbuild.config.ts).
        const require = createRequire(import.meta.url)
        const rootPath = api.context.rootPath
        // Auto-init module prepended to every background entry (see the
        // background entry below). Resolved through the exports map: tsc
        // emits src/background/bootstrap.ts →
        // dist/background/bootstrap.js.
        const backgroundBootstrap = require.resolve('@lynx-solid/runtime/bootstrap')
        // Official worklet runtime (self-initializing IIFE), reused verbatim.
        // Bundled into every MT entry:
        // it must evaluate as part of the entry graph on web AND device
        // (encode-time chunk injection only covers the lynx path and breaks
        // web preview, where nothing else provides the worklet globals).
        const workletRuntimePath = require.resolve('@lynx-js/react/worklet-runtime')

        // Upstream leak (see src/server-functions-stub.ts): the server-function
        // client evaluates `new TextEncoder()` at import time and the router
        // pulls it in unconditionally. Lynx has no server-function runtime, so
        // the module leaves the graph instead of the host gap being filled.
        // Lynx environments only — the web preview keeps the real module, which
        // a browser evaluates fine. Remove when
        // tests/behavior/upstream-leak.test.ts starts failing.
        if (isLynx) {
          chain.resolve.alias.set(
            SERVER_FUNCTIONS_SPECIFIER,
            resolveLoader('server-functions-stub'),
          )
        }

        const entries = chain.entryPoints.entries() ?? {}

        const mtDir = path.dirname(mainThreadEntry)
        const registryBasename = existsSync(path.join(mtDir, 'skeleton-registry.ts'))
          ? 'skeleton-registry.ts'
          : 'skeleton-registry.js'
        const registryModuleFrom = (fromDir: string): string => `./${path.relative(
          fromDir,
          path.join(mtDir, registryBasename),
        ).replaceAll(path.sep, '/')}`

        // Skeleton import specs are collected before the chain is built so
        // the MT entry can import them. Actual module CONTENT is generated
        // in-memory by VirtualSkeletonPlugin at every resolve (the fork-dom
        // compile is shared through compileDomModuleCached) — nothing is
        // written to disk. The spec sits under node_modules/ (see
        // VIRTUAL_SKELETON_DIR) so the watcher stays out of the picture.
        const skeletonTargets = collectSkeletonTargets(entries, rootPath, registryModuleFrom)
        const skeletonImports = new Map<string, string[]>()
        for (const target of skeletonTargets) {
          const skeletonImps: string[] = skeletonImports.get(target.entryName) ?? []
          skeletonImps.push(`./${target.skeletonPath}`)
          skeletonImports.set(target.entryName, skeletonImps)
        }

        // Mirror lynx-stack applyLoaders: reuse Rsbuild's default JS rule and
        // branch it by issuer layer instead of owning separate rules. This
        // keeps default swc/sourcemap/HMR handling (instead of the previous
        // hand-rolled es2017 swc options) and removes the double-processing
        // overlap where both the default rule and ours matched the same file.
        // Device syntax baseline — the one knob that says how new the syntax
        // on the device may be. `es2017` matches `pluginLynx`
        // (packages/rspeedy/plugin-lynx/src/utils/getESVersionTarget.ts), i.e.
        // everything ES2018+ is lowered and ES2017-and-below is left alone
        // because the engines parse it.
        //
        // Expressed as an explicit `env.include` rather than `jsc.target`
        // because the two are mutually exclusive in SWC (pluginLynx throws on a
        // user-set `jsc.target` for exactly this reason), and `env` is what
        // supports per-transform `include`/`exclude`.
        //
        // A dependency shipping newer syntax is handled by bumping this list
        // (one place), NOT by `forceAllTransforms` — see the BG rule below.
        const DEVICE_ENV_INCLUDE = [
          // ES2018
          'transform-async-generator-functions',
          'transform-dotall-regex',
          'transform-named-capturing-groups-regex',
          'transform-object-rest-spread',
          'transform-unicode-property-regex',
          // ES2019
          'transform-json-strings',
          'transform-optional-catch-binding',
          // ES2020
          'transform-nullish-coalescing-operator',
          'transform-optional-chaining',
          'transform-export-namespace-from',
          // ES2021
          'transform-logical-assignment-operators',
          'transform-numeric-separator',
          // ES2022
          'transform-class-properties',
          'transform-class-static-block',
          'transform-private-methods',
          'transform-private-property-in-object',
        ]
        // Paired with the baseline: a high target so `env` auto-includes
        // nothing and `DEVICE_ENV_INCLUDE` is the canonical transform set
        // (same reasoning as pluginLynx's `ES_ENV_TARGETS`).
        const DEVICE_ENV_TARGETS = { chrome: '120' }
        const jsRule = chain.module.rule(CHAIN_ID.RULE.JS)
        const jsMainRule = jsRule.oneOf(CHAIN_ID.ONE_OF.JS_MAIN)
        const jsType = jsMainRule.get('type') as string | undefined
        const jsUses = jsMainRule.uses.entries() ?? {}
        jsMainRule.uses.clear()

        const swcBase = (jsUses[CHAIN_ID.USE.SWC] as unknown as { entries: () => { options: Record<string, unknown> } }).entries()
        const stripTarget = (o: Record<string, unknown>): Record<string, unknown> => {
          // Returns the `jsc` block itself, not the whole options — a `jsc.target`
          // would suppress the `env` transforms.
          const jsc = { ...(o.jsc as Record<string, unknown> | undefined) }
          delete jsc.target
          return jsc
        }

        const backgroundRule = jsMainRule.oneOf(LAYERS.BACKGROUND)
        backgroundRule
          .issuerLayer(LAYERS.BACKGROUND)
          .when(jsType !== undefined, rule => rule.type(jsType!))
          .uses
          .merge(jsUses)
          .end()
          .use('skeleton-loader')
          .loader(resolveLoader('skeleton-loader'))
          .end()

        // The BG bundle's ES2021 syntax comes almost entirely from node_modules
        // (solid-js' client build alone carries `?.` x421 / `??` x118 / `??=` x28),
        // and the rules above cannot reach it: rsbuild's builtin JS rule excludes
        // node_modules, so those files are compiled by the bundler with no
        // transform at all. Devices that run the BG on QuickJS instead of V8
        // then fail to parse the bundle outright —
        // `SyntaxError: unexpected token in expression: '='` (QuickJS reads
        // `a ??= b` as `a ??` and chokes on the `=`) — which surfaces as
        // `loadCard failed` and a blank card with no BG ops ever shipped.
        //
        // This rule re-runs those packages through the MT env so the BG clears
        // the same device ceiling the MT does. It is unconditional: a lower
        // syntax target is never wrong for the BG, which is plain JS with no
        // engine-specific syntax.
        //
        // This rule covers ALL of node_modules. It used to be a whitelist
        // (`@solidjs|solid-js`, later `@tanstack`), and every dependency that
        // shipped ES2021 forced either a plugin release or an app-side config
        // edit — the "users must patch our config to build" failure mode. The
        // blanket transform costs a few percent of bundle size and nothing
        // measurable in build time, which is the right trade: new syntax in a
        // dependency is now a non-event.
        //
        // `forceAllTransforms` is deliberately NOT set: it means "run every
        // transform SWC knows regardless of targets", i.e. drop the baseline
        // well below what the engines need — it rewrites arrow functions,
        // classes, destructuring and templates that QuickJS parses fine, and
        // it is not semantically neutral either (lowering `class` has turned a
        // TDZ error into a silent `undefined` on MT once-builds). Wider
        // coverage comes from extending `DEVICE_ENV_INCLUDE`, which is exactly
        // what `pluginLynx` does — it has no `forceAllTransforms` either.
        //
        // The rule is NOT optional in practice: with it off, node_modules keep
        // their `?.`/`??`/`??=` and the BG fails to parse on QuickJS devices —
        // that is the `loadCard failed` blank card this rule exists to prevent.
        chain.module
          .rule('solid:bg-node-modules-downlevel')
          .test(/\.[cm]?js$/)
          .include
          .add(/[\\/]node_modules[\\/]/)
          .end()
          .when(jsType !== undefined, rule => rule.type(jsType!))
          .use(CHAIN_ID.USE.SWC)
          .merge(swcBase)
          .options({
            ...swcBase.options,
            jsc: stripTarget(swcBase.options),
            env: {
              ...(swcBase.options.env as Record<string, unknown> | undefined),
              targets: DEVICE_ENV_TARGETS,
              include: [...DEVICE_ENV_INCLUDE],
            },
          })
          .end()

        // Shared subtree as PURE MODULE-GRAPH STATE — no source rewrites:
        //
        //   root:    the user marks `with { runtime: 'shared' }` on the one
        //            import that opens the subtree; that rule matches and
        //            marks the TARGET with `.layer(LAYERS.SHARED)` (and the
        //            pass-through swc pipeline — never worklet-mt-loader, so
        //            exports survive).
        //   cascade: every import FROM a shared-layer module matches by
        //            issuerLayer and marks its own target shared in turn —
        //            value, bare side-effect and re-export edges alike, with
        //            no syntax-aware tagger touching a single file.
        //
        // Signal model (one hand-written signal, two stages): the `with`
        // attribute is the ONLY user-facing mark — it feeds the official
        // SWC `_c` decision AND triggers this root rule; `layer` is merely
        // its graph-side projection that propagates the root's decision
        // downstream (which is also why downstream files never carry the
        // attribute: nothing rewrites them). `_c` capture and shell
        // degradation are disjoint diseases with disjoint cures: a worklet
        // that directly references an import needs that edge hand-marked
        // (SWC), a shelled dependency chain needs this cascade (bundler).
        //
        // Both rules must be registered BEFORE mainThreadRule so first-match
        // wins on overlapping issuer layers (root also overlaps the plain
        // MAIN_THREAD chain: same issuer, `with` condition separates them).
        // Per-thread macros (`__MAIN_THREAD__` …) ride mt-macro after swc
        // (same order as the old `!!mt-macro!swc` chain).
        const mtMacroPath = path
          .join(
            path.dirname(createRequire(import.meta.url).resolve('@lynx-solid/compiler/package.json')),
            'mt-macro.cjs',
          )
          .replaceAll('\\', '/')

        /** Shared swc options: es2019 MT baseline + keep import attributes. */
        const applyMtSwcOptions = (rule: {
          use: (id: string) => {
            merge: (obj: Partial<Record<string, unknown>>) => {
              options: (o: Record<string, unknown>) => unknown
            }
          }
        }): void => {
          const useEntry = (jsUses as Record<string, unknown>)[CHAIN_ID.USE.SWC]
          if (useEntry === undefined)
            return
          // Same shape as the previous inline path: Use.entries() → { options }.
          const swcLoaderRule = (useEntry as { entries: () => unknown }).entries() as Record<string, unknown>
          const swcLoaderOptions = swcLoaderRule.options as Record<string, unknown>
          const jsc = { ...(swcLoaderOptions.jsc as Record<string, unknown>) }
          delete jsc.target
          const experimental = {
            ...(jsc.experimental as Record<string, unknown> | undefined),
            // rspack/swc strip `with { … }` unless this is on — then
            // rules[].with never sees the attribute (A2 hop-1/hop-2).
            keepImportAttributes: true,
          }
          jsc.experimental = experimental
          rule.use(CHAIN_ID.USE.SWC)
            .merge(swcLoaderRule)
            .options({
              ...swcLoaderOptions,
              jsc,
              env: {
                ...(swcLoaderOptions.env as Record<string, unknown>),
                targets: DEVICE_ENV_TARGETS,
                include: ['transform-block-scoping', ...DEVICE_ENV_INCLUDE],
              },
            })
        }

        /**
         * Loader chain shared by the root and cascade rules: pass-through
         *  swc + mt-macro; the matched TARGET lands in LAYERS.SHARED.
         */
        type SharedRuleChain = ReturnType<typeof jsMainRule.oneOf>
        const applySharedChain = (rule: SharedRuleChain): void => {
          rule
            .when(jsType !== undefined, r => r.type(jsType!))
            .merge({ layer: LAYERS.SHARED })
            .use('mt-macro')
            .loader(mtMacroPath)
            .end()
            .uses
            .merge(jsUses)
            .end()
          applyMtSwcOptions(rule)
          rule.sideEffects(true)
        }

        const sharedRootRule = jsMainRule.oneOf('solid:shared-root')
        sharedRootRule
          .issuerLayer(LAYERS.MAIN_THREAD)
          // Match import attributes on the *dependency* (the shared target).
          .merge({ with: { runtime: 'shared' } })
        applySharedChain(sharedRootRule)

        const sharedCascadeRule = jsMainRule.oneOf('solid:shared-cascade')
        sharedCascadeRule
          .issuerLayer(LAYERS.SHARED)
        applySharedChain(sharedCascadeRule)

        // background-only marker (ReactLynx pattern, ported from plugin-react
        // backgroundOnly.ts): the poisoned module resolves per
        // issuer layer — BG to the package's empty.js (harmless), MAIN_THREAD
        // to error.js, which invalid-import-error-loader fails on. That turns
        // "a shared module imports BG-only code" from a silent half-evaluated
        // edge into a build error naming the importer (rspack's module chain
        // reports the error module's issuer). Plain (non-shared) MT modules
        // never see the marker: worklet-mt-loader drops bare package edges
        // into their shell. Per-layer aliases instead of the package's
        // `lepus` export condition — our resolve conditionNames
        // (lynx/import/require/browser) never request it.
        const backgroundOnlyEmpty = require.resolve('background-only')
        const backgroundOnlyError = path.join(path.dirname(backgroundOnlyEmpty), 'error.js')
        chain.module
          .rule('solid:alias-background-only-mt')
          .issuerLayer(LAYERS.MAIN_THREAD)
          .resolve
          .alias
          .set('background-only$', backgroundOnlyError)
        chain.module
          .rule('solid:alias-background-only-bg')
          .issuerLayer(LAYERS.BACKGROUND)
          .resolve
          .alias
          .set('background-only$', backgroundOnlyEmpty)
        chain.module
          .rule('solid:detect-background-only-import')
          .test(backgroundOnlyError)
          .issuerLayer(LAYERS.MAIN_THREAD)
          .use('solid:detect-background-only-import')
          .loader(resolveLoader('invalid-import-error-loader'))
          .options({
            message: '\'background-only\' cannot be imported from a main-thread module (BG-only code reached the shared MT graph).',
          })
          .end()

        const mainThreadRule = jsMainRule.oneOf(LAYERS.MAIN_THREAD)
        mainThreadRule
          .issuerLayer(LAYERS.MAIN_THREAD)
          .when(jsType !== undefined, rule => rule.type(jsType!))
          .uses
          .merge(jsUses)
          .end()
        applyMtSwcOptions(mainThreadRule)

        // Under IFR the MT runs the same renderer the BG does, so the runtime's
        // background modules must reach it WHOLE instead of being reduced to
        // registration stubs. Excluded from worklet-mt-loader, and given its
        // own rule carrying the DEFAULT uses — deliberately placed HERE, before
        // worklet-mt-loader is added to `mainThreadRule`, so the copied `uses`
        // do not include the loader that would strip them again.
        if (options.enableMtIfr) {
          chain.module
            .rule('solid:mt-ifr-runtime')
            .issuerLayer(LAYERS.MAIN_THREAD)
            .test(/\.[cm]?[jt]sx?$/)
            .include
            .add(isIfrRuntimeModule)
            .end()
            .when(jsType !== undefined, rule => rule.type(jsType!))
            .uses
            .merge(mainThreadRule.uses.entries() ?? {})
            .end()
            .sideEffects(true)
            .end()
          mainThreadRule.exclude.add(isIfrRuntimeModule).end()

          // The MT copy of the app graph must evaluate against Solid's ONE-SHOT
          // build, scoped to the MAIN_THREAD layer — the BG keeps the client
          // build (it owns the live reactive graph). The trailing `$` is
          // webpack/rspack's exact-match convention: `^…$` would be a LITERAL
          // key (leading caret), matching nothing. Both alias targets are
          // derived from the MT entry, not the exports map — see
          // `resolveIfrRuntime` for why mixing trees is fatal.
          //
          // STAGED COPY, not the file in place. Solid's one-shot build and its
          // signals dependency ship as DIST files carrying ES2021+ syntax
          // (`?.`, `??=`, `||=`, `#private`) that the Lepus bytecode compiler
          // rejects. A rule pointing into node_modules cannot rescue them
          // (rspack applies no custom module rule under node_modules), so
          // staging a copy under `.lynx-solid/` is what makes the ordinary MT
          // rules treat them as project source. The whole `dist` tree is copied
          // because signals' prod build is 20 relative `./core/*.js` modules;
          // only the bare `@solidjs/signals` specifier is re-pointed.
          //
          const onceDir = path.join(rootPath, '.lynx-solid')
          const solidPkgDir = path.dirname(require.resolve('solid-js/package.json'))
          const signalsPkgDir = path.dirname(require.resolve('@solidjs/signals/package.json'))

          mkdirSync(onceDir, { recursive: true })
          const stagedSolid = path.join(onceDir, 'solid/server.js')
          mkdirSync(path.dirname(stagedSolid), { recursive: true })
          copyFileSync(path.join(solidPkgDir, 'dist/server.js'), stagedSolid)
          const stagedSignalsDir = path.join(onceDir, 'signals')
          copyDirSync(path.join(signalsPkgDir, 'dist'), stagedSignalsDir)

          // `javascript/esm`, NOT the MT default `javascript/auto`: `auto`
          // loosens module semantics enough to cost tree-shaking.
          //
          // `sideEffects(true)` — deliberately the OPPOSITE of the packages'
          // own `sideEffects: false`: the reason is evaluation ORDER, not
          // dead-code elimination. `@solidjs/signals/prod/index.js` barrels
          // over a `core ↔ async ↔ scheduler` cycle that only evaluates
          // correctly in native ESM source order. With `sideEffects: false`
          // rspack re-orders the requires, entering the cycle at `scheduler.js`
          // first, so `core.js` writes `GlobalQueue.Fe` while `scheduler` is
          // mid-evaluation — device symptom: `TypeError: cannot set property
          // 'Fe' of undefined`, blank screen.
          const onceBuildRule = chain.module
            .rule('solid:mt-ifr-once-builds')
            // No `issuerLayer`: with it the staged files miss the MT swc
            // transform and reach Lepus with ES2021+ syntax intact
            // (`SyntaxError: expecting ')'`). The staged tree is only reachable
            // through the MT-scoped aliases anyway.
            //
            // The staged dist is lowered by the same `transform-block-scoping +
            // DEVICE_ENV_INCLUDE` set the MT rule uses — `forceAllTransforms`
            // would take it far below the syntax the engines accept, for no
            // parse benefit (Lepus encodes the env-list output).
            .test(/\.lynx-solid[\\/]/)
            .type('javascript/esm')
            .sideEffects(true)
            .when(jsType !== undefined, rule => rule.type(jsType!))
          applyMtSwcOptions(
            onceBuildRule as unknown as Parameters<typeof applyMtSwcOptions>[0],
          )
          mainThreadRule.exclude.add(/\.lynx-solid[\\/]/).end()

          chain.module
            .rule('solid:alias-ifr-mt')
            .issuerLayer(LAYERS.MAIN_THREAD)
            .resolve
            .alias
            .set('solid-js$', stagedSolid)
            .set('@solidjs/signals$', path.join(stagedSignalsDir, 'prod/index.js'))
            .end()

          // The runtime alias must NOT carry `issuerLayer(MAIN_THREAD)`: with
          // it the app's `import { render } from '@lynx-solid/runtime'` never
          // reaches `ifr-runtime`, so `registerIfrRoot` never runs and
          // `runIfrMount` bails with `enabled=false` — silent non-IFR
          // degradation. The BG is unaffected: it resolves the runtime through
          // its own path. One tree only — the `…/lynx-template` subpath is not
          // aliased here, because it would answer from the exports map, i.e.
          // possibly the OTHER build tree; rspack then instantiates the runtime
          // twice and IFR dies silently (see ifr-alias.ts).
          const ifrAlias = chain.module
            .rule('solid:alias-ifr-runtime')
            .issuerLayer(LAYERS.MAIN_THREAD)
            .resolve
            .alias
          for (const [specifier, target] of Object.entries(ifrRuntimeAliases(mainThreadEntry)))
            ifrAlias.set(specifier, target)
          ifrAlias.end()
        }

        // Bootstrap modules excluded from worklet-mt-loader below still
        // need the standard JS/TS pipeline: they are real .ts sources, and
        // the exclude removes the whole MT oneOf branch — including swc —
        // for them. Without this rule they reach the parser untransformed
        // (`import type` parse error). This copies the branch's default
        // uses (already carrying the es2019 baseline tweak above) but never
        // adds worklet-mt-loader, so bootstrap executes intact on the MT.
        chain.module
          .rule('solid:mt-bootstrap')
          .issuerLayer(LAYERS.MAIN_THREAD)
          .test(/\.[cm]?[jt]sx?$/)
          .include
          .add(isBootstrapModule)
          .end()
          .when(jsType !== undefined, rule => rule.type(jsType!))
          .uses
          .merge(mainThreadRule.uses.entries() ?? {})
          .end()
          .sideEffects(true)
          .end()

        mainThreadRule
          .exclude
          .add(isBootstrapModule)
          .end()
          .use('worklet-mt-loader')
          .loader(resolveLoader('worklet-mt-loader'))
          .options({
            // Per-app layout: every sample lives in its own package with an
            // `src/` root (examples/<name>/src), so the worklet shell keys off the
            // app root's src dir instead of the old monolith dev/src.
            srcRoot: path.resolve(rootPath, 'src'),
            includeWorkletPackages: options.includeWorkletPackages ?? [],
            // MT-IFR: flip the MT from "import shells only" to "run the real
            // module graph", so that `render()` at module scope actually
            // produces the first-screen tree inside `renderPage`.
            enableIfr: options.enableMtIfr ?? false,
          })
          .end()
          .sideEffects(true)
        chain.module
          .rule('skeleton-mt')
          .layer(LAYERS.MAIN_THREAD)
          .test(/\.ts$/)
          .include
          .add(/\.lynx-solid[\\/]skeletons/)
          .end()
          .sideEffects(true)
          .end()
        chain
          .plugin(VIRTUAL_SKELETON_PLUGIN)
          .use(VirtualSkeletonPlugin, [
            skeletonTargets.map(({ entryName, entrySrc, skeletonPath, registryModule }) => ({
              entryName,
              entrySrc,
              skeletonSpec: skeletonPath,
              registryModule,
            })),
          ])
          .end()
        chain.entryPoints.clear()

        const mainThreadFilenames: string[] = []

        for (const [entryName, entryPoint] of Object.entries(entries)) {
          const imports: string[] = collectEntryImports(entryPoint)

          // MT-IFR: user entries call `render()` at module scope, but the
          // native page root only exists once the engine calls `renderPage` —
          // after the bundle evaluated. The MT copy of the runtime therefore
          // defers the mount and installs the IFR render hook (ifr-runtime.ts).
          // It must evaluate BEFORE user code, hence this rather than relying
          // on the `@lynx-solid/runtime$` alias alone (the alias still owns
          // resolution; this only owns ordering).
          //
          // Injected HERE rather than imported by the MT bootstrap so that a
          // non-IFR build carries none of it.
          const ifrImports = options.enableMtIfr
            ? [resolveIfrRuntime(mainThreadEntry)]
            : []

          const intermediate = isLynx ? DEFAULT_INTERMEDIATE : ''
          const mainThreadEntryName = `${entryName}__main-thread`
          const mainThreadName = path.posix.join(
            intermediate,
            `${entryName}/main-thread.js`,
          )
          const backgroundName = path.posix.join(
            intermediate,
            `${entryName}/background${isProd ? '.[contenthash:8]' : ''}.js`,
          )

          mainThreadFilenames.push(mainThreadName)

          chain
            .entry(mainThreadEntryName)
            .add({
              layer: LAYERS.MAIN_THREAD,
              // Bootstrap FIRST (exposes SystemInfo + runOnBackground that
              // the official runtime's IIFE reads at load time), then the
              // runtime bundle, then user code (worklet registrations), then
              // the skeleton module.
              // NOTE: the IIFE stays unconditional (not beforeEncode-gated):
              // the encode hook only fires on the lynx path, but the web
              // preview needs the runtime too — gating it breaks MT on web.
              import: [mainThreadEntry, workletRuntimePath, ...ifrImports, ...imports, ...(skeletonImports.get(entryName) ?? [])],
              filename: mainThreadName,
            })
            .end()

          chain
            .entry(entryName)
            .add({
              layer: LAYERS.BACKGROUND,
              // The auto-init module is PREPENDED so initBackground() wires
              // the event bridge / ops transport before any user code runs —
              // entries no longer call it manually.
              import: [backgroundBootstrap, ...imports],
              filename: backgroundName,
            })
            .end()

          const templateFilename
            = (typeof environment.config.output.filename === 'object'
              ? (
                  environment.config.output.filename as {
                    bundle?: string
                  }
                ).bundle
              : environment.config.output.filename)
            ?? '[name].[platform].bundle'

          chain
            .plugin(`${PLUGIN_TEMPLATE}-${entryName}`)
            .use(LynxTemplatePlugin, [
              {
                // Spread defaults first to satisfy all required fields
                ...LynxTemplatePlugin.defaultOptions,
                // Explicit parity with ReactLynx entry.ts / vue entry.ts —
                // do not rely on template defaultOptions drift.
                dsl: 'react_nodiff',
                enableCSSInvalidation: true,
                // No scoped-CSS story yet (cssId=0); treat CSS as global
                // like React. Flip to false + cssScope when real scoping lands.
                enableRemoveCSSScope: true,
                removeDescendantSelectorScope: true,
                enableCSSInheritance: options.enableCSSInheritance ?? false,
                customCSSInheritanceList: options.customCSSInheritanceList,
                chunks: [mainThreadEntryName, entryName],
                filename: templateFilename
                  .replaceAll('[name]', entryName)
                  .replaceAll('[platform]', environment.name),
                intermediate: path.posix.join(intermediate, entryName),
              },
            ])
            .end()
        }

        if (mainThreadFilenames.length > 0) {
          chain
            .plugin(PLUGIN_MARK_MAIN_THREAD)
            .use(MarkMainThreadPlugin, [mainThreadFilenames])
            .end()
        }

        if (isLynx) {
          // Official removeLightningCSS (as in plugin-react / pluginLynx):
          // delete `builtin:lightningcss-loader` from main + inline CSS rules
          // so lightningcss never rewrites top/left/right/bottom → inset.
          // lynx env also sets `tools.lightningcssLoader: false` (see
          // modifyRsbuildConfig) which prevents rsbuild from attaching the
          // loader at all; this delete remains as a safety net for
          // sass/less/stylus rules and for toolchains that attach before
          // the flag is consulted.
          const removeLightningCSS = (rule: {
            uses: { has: (id: string) => boolean, delete: (id: string) => unknown }
          }): void => {
            if (rule.uses.has(CHAIN_ID.USE.LIGHTNINGCSS))
              rule.uses.delete(CHAIN_ID.USE.LIGHTNINGCSS)
          }
          const cssRules = [
            CHAIN_ID.RULE.CSS,
            CHAIN_ID.RULE.SASS,
            CHAIN_ID.RULE.LESS,
            CHAIN_ID.RULE.STYLUS,
          ] as const
          for (const ruleName of cssRules) {
            if (!chain.module.rules.has(ruleName))
              continue
            const rule = chain.module.rule(ruleName)
            const mainRuleName = ruleName === CHAIN_ID.RULE.CSS
              ? CHAIN_ID.ONE_OF.CSS_MAIN
              : ruleName
            if (rule.oneOfs.has(mainRuleName))
              removeLightningCSS(rule.oneOf(mainRuleName))
            else
              removeLightningCSS(rule)
            // Inline / url oneOf branches also carry the loader
            // (rsbuild updateRules skips main only when !emitCss).
            const ONE_OF = CHAIN_ID.ONE_OF as Record<string, string | undefined>
            const extraOneOfs = ruleName === CHAIN_ID.RULE.CSS
              ? [ONE_OF.CSS_INLINE, ONE_OF.CSS_URL].filter(Boolean)
              : [`${ruleName}-inline`, `${ruleName}-url`]
            for (const oneOfName of extraOneOfs) {
              if (oneOfName && rule.oneOfs.has(oneOfName))
                removeLightningCSS(rule.oneOf(oneOfName))
            }
          }

          if (Object.keys(cssConfigOptions).length > 0) {
            chain
              .plugin(PLUGIN_CSS_CONFIG)
              .use(CSSConfigPlugin, [cssConfigOptions])
              .end()
          }
          chain
            .plugin(PLUGIN_RUNTIME_WRAPPER)
            .use(RuntimeWrapperWebpackPlugin, [
              {
                // Wrap all `.js` except `main-thread.js` (and hashed
                // variants) — the main-thread bundle must run as-is.
                test: /^(?!.*main-thread(?:\.[A-Fa-f0-9]*)?\.js$).*\.js$/,
              },
            ])
            .end()
            .plugin(PLUGIN_ENCODE)
            .use(LynxEncodePlugin, [{}])
            .end()
        }

        if (isWeb) {
          chain.plugin(PLUGIN_WEB_ENCODE).use(WebEncodePlugin, []).end()
        }

        chain.output.set('iife', false)
      })
    },
  }
}
