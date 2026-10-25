/**
 * worklet-mt-loader: extracts worklet registrations and skeleton templates
 * for the Main Thread layer.
 *
 * Mirrors the equivalent Lynx framework plugin behaviour: the MT entry imports
 * the same user entry files as the BG entry, so the bundler dependency graph
 * pulls every component into the MT layer. Import scanning comes from the ported
 * `./worklet-utils.js` (shared/local imports, allowlist, literal masking);
 * worklet bodies come from the official SWC transform (JS preferred, LEPUS
 * fallback for shared-only worklets).
 *
 * Bootstrap modules (main-thread/* + internal/*) never reach this loader:
 * they are excluded at rule level (isBootstrapModule in `./index.js`) and
 * execute intact on the main thread. Shared targets and their transitive
 * value-import graph match `solid:shared-mt` (rules[].with) and never reach
 * this loader — full exports, no node_modules path carve-out. Everything
 * else that reaches the loader is user-side: without templates, worklets, or
 * shared imports it degrades to an import shell, so a pure-TS module can
 * never smuggle live cross-module bindings into the MT graph (the failure
 * mode TanStack's generated routeTree.gen.ts hit: full-passthrough kept
 * `import { Route }` alive in MT while the route files compiled to
 * export-less shells).
 */

import type { ResolveImport } from '@lynx-solid/compiler'
import type { LoaderContext } from '@rspack/core'
import { createRequire } from 'node:module'
import path from 'node:path'
import { transformReactLynxSync } from '@lynx-js/react/transform'
import { compileDomModuleCached, extractLocalImports, extractSharedImports, extractWorkletCalls } from '@lynx-solid/compiler'

export interface WorkletLoaderMTOptions {
  srcRoot?: string
  /**
   * Allowlist of bare-import specifiers whose `'main thread'` worklets must
   * be followed into the MT module graph even though they resolve into
   * `node_modules`. Same semantics as vue-lynx's `includeWorkletPackages`.
   */
  includeWorkletPackages?: ReadonlyArray<string | RegExp>
  /**
   * MT-IFR: emit the FULL fork-dom compiled body on the MT instead of the
   * import-shell degradation. Only meaningful when the plugin option
   * `enableMtIfr` is on — see that option for the runtime picture.
   */
  enableIfr?: boolean
}

const STYLE_RE = /\.(?:css|less|scss|sass)$/i

/**
 * Side-effect import block for the MT graph, minus style sub-modules (CSS
 * comes from the background layer; processing it again would duplicate it).
 */
async function localImportsFiltered(
  source: string,
  resolveImport: ResolveImport,
  includeWorkletPackages: ReadonlyArray<string | RegExp>,
): Promise<string> {
  const block = await extractLocalImports(source, resolveImport, includeWorkletPackages)
  if (!block)
    return ''
  const kept = block.split('\n').filter((line) => {
    const m = line.match(/from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/)
    const spec = m?.[1] ?? m?.[2] ?? ''
    return !STYLE_RE.test(spec)
  })
  return kept.join('\n')
}

/**
 * Run the LEPUS worklet transform on Babel output (pure JS — the
 * `main-thread:` JSX namespace SWC cannot parse is already gone by now).
 * Same input the BG layer feeds its JS-target pass, so `bdbc:` ids agree.
 * Returns the transformed code, or null on failure (caller falls back to
 * imports-only output and reports the error).
 */
function runLepusTransform(
  loader: LoaderContext,
  babelCode: string,
  filename: string,
  pluginName = 'lynx-solid:worklet-mt',
): string | null {
  const result = transformReactLynxSync(babelCode, {
    pluginName,
    filename,
    sourcemap: false,
    cssScope: false,
    snapshot: false,
    shake: false,
    compat: false,
    refresh: false,
    defineDCE: {
      // Official per-thread built-in macro map (mirror @lynx-js/react
      // transform defines.spec: String(target === 'LEPUS')).
      define: {
        __LEPUS__: 'true',
        __MAIN_THREAD__: 'true',
        __JS__: 'false',
        __BACKGROUND__: 'false',
      },
    },
    directiveDCE: { target: 'LEPUS' },
    worklet: {
      target: 'LEPUS',
      filename,
      runtimePkg: '@lynx-solid/runtime',
    },
  })
  if (result.errors.length > 0) {
    for (const err of result.errors)
      loader.emitError(new Error(`[worklet-mt-loader] LEPUS transform: ${err.text}`))
    return null
  }
  return result.code
}

export default function workletMtLoader(
  this: LoaderContext<WorkletLoaderMTOptions>,
  source: string,
): void {
  // Resolution requires an async loader (`this.async()`); the loader output
  // stays a pure function of (source, resolve config), so caching is sound.
  this.cacheable(true)
  const callback = this.async()
  const options = this.getOptions() ?? {}
  const includeWorkletPackages = options.includeWorkletPackages ?? []

  // Resolve specifiers exactly as the importing module would (honours the
  // bundler's alias + tsconfig `paths`). Unresolvable specifiers resolve to
  // `null` so the caller can skip them instead of failing the build.
  const resolver = this.getResolve({}) as (
    context: string,
    request: string,
  ) => Promise<string | false | undefined>
  const context = this.context ?? this.rootContext
  const resolveImport: ResolveImport = async (specifier) => {
    try {
      return (await resolver(context, specifier)) || null
    }
    catch {
      return null
    }
  }

  transformModule(this, source, resolveImport, includeWorkletPackages).then(
    result => callback(null, rewriteRuntimeSpecifier(result, options.enableIfr ?? false)),
    err => callback(err instanceof Error ? err : new Error(String(err))),
  )
}

/**
 * MT-layer `@lynx-solid/runtime` specifier → MT runtime surface.
 *
 * Compiled worklet bodies keep their source import (`runOnBackground`
 * inside `finishSettle` etc.), but the specifier must not resolve to the
 * background package entry — its MT-layer transform is an empty shell, so
 * the call throws "runOnBackground is not a function" at dismiss time.
 * Rewrites to the MT runtime surface (single-tree tsc build:
 * src/main-thread/runtime.ts → dist/main-thread/runtime.js).
 * Only `from '…'` clauses are rewritten, never string literals inside
 * worklet code.
 */
const MT_RUNTIME_SPECIFIER = JSON.stringify(
  path.join(
    path.dirname(createRequire(import.meta.url).resolve('@lynx-solid/runtime/package.json')),
    'dist/main-thread/runtime.js',
  ),
)

/**
 * Point every runtime-package import at the MT runtime module.
 *
 * Skipped entirely under `enableIfr`: the plugin aliases the runtime package to
 * `main-thread/ifr-runtime` for MT-layer imports, and rewriting the specifier
 * here would silently override that alias — the MT would get the empty shell
 * instead of the module that installs the IFR render hook.
 */
function rewriteRuntimeSpecifier(output: string, enableIfr: boolean): string {
  if (enableIfr)
    return output
  return output.replace(
    /from\s*(['"])@lynx-solid\/runtime\1/g,
    `from ${MT_RUNTIME_SPECIFIER}`,
  )
}

async function transformModule(
  ctx: LoaderContext<WorkletLoaderMTOptions>,
  source: string,
  resolveImport: ResolveImport,
  includeWorkletPackages: ReadonlyArray<string | RegExp>,
): Promise<string> {
  const norm = (p: string): string => p.replaceAll('\\', '/').toLowerCase()
  const res = norm(ctx.resourcePath)
  // Generated skeleton modules are already final JS — pass through untouched.
  if (res.includes('.lynx-solid/skeletons/'))
    return source
  const options = ctx.getOptions() ?? {}
  const normalizedSrcRoot = options.srcRoot ? norm(options.srcRoot) : ''
  // Project source only — no path special cases (node_modules has no
  // compileFull carve-out; shared edges never reach this loader).
  const underSrc = normalizedSrcRoot !== '' && res.startsWith(normalizedSrcRoot)

  // MT-IFR: the MT renders the app for real, so the import-shell degradation at
  // the bottom of this function is exactly backwards — it strips the component
  // bodies and keeps only `registerSkeleton`, so `render()` never runs and the
  // first screen collapses to an empty page root. Under IFR every module of the
  // MT graph is therefore compiled for real; there is no per-package opt-out,
  // because an import shell is precisely the state that renders nothing.
  //
  // Note the component code is in the bundle either way: `registerSkeleton`
  // carries it as a string payload. Grepping the bundle for a component's class
  // names therefore proves nothing about whether its logic executes — that
  // misreading is what hid this on device.
  const enableIfr = options.enableIfr ?? false

  // Full fork-dom compile (Babel skeleton + SWC JS worklets). The `.worklets`
  // list (non-empty SWC defines) is authoritative — branch decisions below
  // use it instead of string-sniffing for directives (comments trip those).
  const doCompile = (thread?: 'main-thread') => compileDomModuleCached(source, {
    filename: ctx.resourcePath,
    thread,
  })

  const emitSkeletonRegistrations = (compiled: ReturnType<typeof doCompile>): string[] => {
    const regs: string[] = []
    for (const t of compiled.templates)
      regs.push(`registerSkeleton(${t.id}, ${t.createCode})`)
    return regs
  }

  // Worklet registrations go out verbatim — the sliced
  // `registerWorklet[Internal]("type", "id", fn)` calls. Both globals are
  // the same function in the official runtime, and the MT entry bundles
  // its IIFE first, so the dropped `__workletRuntimeLoaded &&` guard is
  // dead weight. JS defines come straight from the full compile above;
  // LEPUS calls cover shared-only worklets (empty JS defines) via a
  // Babel-only recompile of the same source.
  const workletRegistrations = (
    compiled: ReturnType<typeof doCompile>,
    sharedImports: string,
  ): string => {
    const regs: string[] = []
    for (const w of compiled.worklets)
      regs.push(w.code)
    if (sharedImports) {
      const babelOnly = compileDomModuleCached(source, {
        filename: ctx.resourcePath,
        skipWorkletTransform: true,
      })
      const lepusCode = runLepusTransform(ctx, babelOnly.code, ctx.resourcePath)
      if (lepusCode !== null) {
        const seen = new Set(compiled.worklets.map(w => w.id))
        for (const { id, call } of extractWorkletCalls(lepusCode)) {
          if (!seen.has(id))
            regs.push(call)
        }
      }
    }
    return regs.join('\n')
  }

  // MT-IFR: emit the real compiled body instead of an import shell. The default
  // path represents templates as `registerSkeleton` registrations and drops the
  // component logic — so on the MT the app's module-scope `render()` never runs
  // and the first screen collapses to an empty page root. `compiled.code` is the
  // actual compiled module; the registrations still go on top because that is
  // how the templates reach the engine.
  if (enableIfr) {
    // `thread: 'main-thread'` — this is the MT copy executing for real, so the
    // built-in macros must fold to the MT arm here. Leaving them on the
    // background values (the default) makes `__MAIN_THREAD__` read false on the
    // exact thread it is supposed to describe, dropping app-level branches like
    // router search codecs and MT API polyfills from the copy that needs them.
    // The import-shell path keeps the background values: its bodies never
    // execute.
    const compiled = doCompile('main-thread')
    const sharedImports = extractSharedImports(source)
    const regs = [...emitSkeletonRegistrations(compiled)]
    const worklets = workletRegistrations(compiled, sharedImports)
    if (worklets)
      regs.push(worklets)
    const body = [sharedImports, compiled.code, ...regs].filter(Boolean).join('\n')
    return body.endsWith('\n') ? body : `${body}\n`
  }

  if (underSrc) {
    const compiled = doCompile()
    const sharedImports = extractSharedImports(source)

    if (compiled.templates.length === 0 && compiled.worklets.length === 0 && !sharedImports) {
      // No templates, no worklets, no shared imports: degrade to
      // side-effect imports (the bootstrap-module exception) so a pure-TS file
      // can never smuggle live cross-module bindings into the MT graph.
      // Bootstrap modules never reach this loader — they are excluded at rule
      // level and execute intact.
      const safe = await localImportsFiltered(source, resolveImport, includeWorkletPackages)
      const allImports = [sharedImports, safe].filter(Boolean).join('\n')
      return allImports.endsWith('\n') ? allImports : `${allImports}\n`
    }
    const imports = await localImportsFiltered(source, resolveImport, includeWorkletPackages)
    const allImports = [sharedImports, imports].filter(Boolean).join('\n')
    const regs = [...emitSkeletonRegistrations(compiled)]
    const worklets = workletRegistrations(compiled, sharedImports)
    if (worklets)
      regs.push(worklets)
    return `${allImports}\n${regs.join('\n')}\n`
  }

  if (!source.includes('main-thread') && !source.includes('main thread')) {
    const sharedImports = extractSharedImports(source)
    if (sharedImports)
      return `${sharedImports}\n${await localImportsFiltered(source, resolveImport, includeWorkletPackages)}\n`
    return localImportsFiltered(source, resolveImport, includeWorkletPackages)
  }

  const sharedImports = extractSharedImports(source)
  const compiled = doCompile()
  if (compiled.templates.length === 0 && compiled.worklets.length === 0 && !sharedImports) {
    const safe = await localImportsFiltered(source, resolveImport, includeWorkletPackages)
    const allImports = [sharedImports, safe].filter(Boolean).join('\n')
    return allImports.endsWith('\n') ? allImports : `${allImports}\n`
  }
  const regs = [...emitSkeletonRegistrations(compiled)]
  const worklets = workletRegistrations(compiled, sharedImports)
  if (worklets)
    regs.push(worklets)
  const tailImports = await localImportsFiltered(source, resolveImport, includeWorkletPackages)
  return `${[sharedImports, tailImports].filter(Boolean).join('\n')}\n${regs.join('\n')}\n`
}
