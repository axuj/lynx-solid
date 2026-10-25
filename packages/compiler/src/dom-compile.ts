/**
 * Single-pass pipeline for the fork-compiled skeletons (babel-plugin-jsx-lynx).
 * One transformSync —
 * fork plugin + preset-typescript — yields the final BG module. The extracted
 * templates (createCode for the MT bundle) ride in file.metadata.
 *
 * The fork plugin is consumed from its CJS build so its own @babel version
 * space stays isolated from this project's (types 7 vs helper-module-imports
 * 8). Two layouts are supported:
 *   - published package: dist/index.js → ./jsx-lynx.cjs (same dist dir)
 *   - repo dev:          src/dom-compile.ts → the rslib dev copy
 *     (rslib.fork-plugin.config.ts) at babel-plugin-jsx-lynx/dist/index.cjs
 */

import type { BabelFileMetadata } from '@babel/core'
import type { LynxExtractedTemplate, WorkletRecord } from './types.js'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from '@babel/core'
import { transformReactLynxSync } from '@lynx-js/react/transform'
import { extractSingleWorkletCall, hasMainThreadDirective, hasUIWorkletDirective, stripSharedImportAttributes } from './worklet-utils.js'

function resolveForkPluginPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    // Published: @lynx-solid/compiler dist → dist/jsx-lynx.cjs
    path.resolve(here, './jsx-lynx.cjs'),
    // Repo dev: packages/compiler/src/dom-compile.ts → babel-plugin-jsx-lynx/dist/index.cjs
    path.resolve(here, '../babel-plugin-jsx-lynx/dist/index.cjs'),
  ]
  for (const p of candidates) {
    if (existsSync(p))
      return p
  }
  throw new Error(
    `babel-plugin-jsx-lynx build output not found (tried:\n${candidates.join('\n')})`
    + '\nIn the repo, run `nub run build:fork-plugin` first; in an installed package this file should ship under dist/.',
  )
}

const require = createRequire(import.meta.url)
const jsxLynxPlugin: { default: (babel: typeof import('@babel/core')) => object } = require(resolveForkPluginPath())

export interface DomCompileResult {
  code: string
  templates: LynxExtractedTemplate[]
  worklets: WorkletRecord[]
}

/** BabelFileMetadata + fork-injected template table (postprocess writes it). */
interface LynxBabelFileMetadata extends BabelFileMetadata {
  lynxTemplates?: LynxExtractedTemplate[]
}

export interface DomCompileOptions {
  filename?: string
  moduleName?: string
  /**
   * Skip the SWC worklet pass and return raw Babel output (directives
   * intact, no worklets). The MT loader uses this as LEPUS input — same
   * Babel output the BG layer feeds its JS-target pass, so `bdbc:` ids
   * agree on both sides.
   */
  skipWorkletTransform?: boolean
  /**
   * Which thread copy this module is being compiled for — decides the
   * built-in macro values (`__MAIN_THREAD__` / `__BACKGROUND__` …).
   *
   * Defaults to `'background'`, which is what the BG layer and the MT
   * import-shell path both want. The MT-IFR full-body path (worklet-mt-loader
   * with `enableIfr`) must pass `'main-thread'`: it emits the real module
   * graph that executes on the main thread, and leaving it on the background
   * values folds every `__MAIN_THREAD__` branch to its background arm — the
   * macro never lies about which copy it is in (lynx Document.built-in-macros).
   *
   * Only the macro map follows this; `directiveDCE` stays on the JS target so
   * worklet ids keep agreeing with the BG copy.
   */
  thread?: 'main-thread' | 'background'
}

export function compileDomModule(
  source: string,
  options: DomCompileOptions = {},
): DomCompileResult {
  const moduleName = options.moduleName
    ?? '@lynx-solid/runtime/lynx-template'
  const filename = options.filename ?? 'component.tsx'
  const babelResult = transformSync(source, {
    filename,
    parserOpts: {
      plugins: ['typescript', 'jsx', 'importAttributes'],
    },
    plugins: [
      [require.resolve('babel-plugin-transform-async-to-promises'), {}],
      [jsxLynxPlugin.default, {
        generate: 'dom',
        moduleName,
        wrapConditionals: true,
        builtIns: [
          'For',
          'Show',
          'Switch',
          'Match',
          'Loading',
          'Reveal',
          'Portal',
          'Repeat',
          'Dynamic',
          'Errored',
          // Compile-rewritten <page> → Page (transparent root wrapper).
          'Page',
        ],
      }],
    ],
    presets: [
      ['@babel/preset-typescript'],
    ],
    babelrc: false,
    configFile: false,
  })
  // BabelFileMetadata carries official fields only; lynxTemplates is this
  // plugin's private payload (postprocess writes file.metadata.lynxTemplates).
  const meta = babelResult?.metadata as LynxBabelFileMetadata | undefined // as: plugin-private metadata, invisible to Babel types
  const templates: LynxExtractedTemplate[] = meta?.lynxTemplates ?? []
  let code = babelResult?.code ?? ''
  let worklets: WorkletRecord[] = []
  if (options.skipWorkletTransform)
    return { code, templates, worklets }

  // Worklets via the official Rust SWC transform (JS target), applied to the
  // Babel output (pure JS — the `main-thread:` JSX namespace SWC cannot
  // parse is already gone). SWC owns free-variable extraction, the
  // `{_c,_wkltId,_jsFn}` shape, shared imports and `bdbc:` ids.
  // Gate on every directive spelling — a file using only the 'main-thread'
  // alias (or 'use worklet') must still reach SWC, or its worklets silently
  // vanish from the MT bundle (the vue prefilter-shortcircuit trap).
  // Flag-only files (no directives, e.g. shim-entry's gate) also reach SWC:
  // that is the only pass applying the official built-in macro map
  // (lynx Document.built-in-macros contract) — with per-copy values, so the
  // same source folds to the MT arm on the MT copy and the BG arm on the BG.
  // Files containing none of the four macro identifiers skip SWC entirely
  // (zero-cost for motion-dom-shaped node_modules code).
  const MACRO_IDENT_RE = /__MAIN_THREAD__|__BACKGROUND__|__LEPUS__|__JS__/
  const isMainThreadCopy = options.thread === 'main-thread'
  if (
    hasMainThreadDirective(source)
    || hasUIWorkletDirective(source)
    || MACRO_IDENT_RE.test(source)
  ) {
    const swc = transformReactLynxSync(code, {
      pluginName: 'lynx-solid:dom',
      filename,
      sourcemap: false,
      cssScope: false,
      snapshot: false,
      shake: false,
      compat: false,
      refresh: false,
      defineDCE: {
        // Official per-thread built-in macro map (mirror @lynx-js/react
        // transform defines.spec: String(target === 'LEPUS')). Per COPY, not
        // per layer — the IFR MT body is a main-thread copy and says so.
        define: {
          __LEPUS__: String(isMainThreadCopy),
          __MAIN_THREAD__: String(isMainThreadCopy),
          __JS__: String(!isMainThreadCopy),
          __BACKGROUND__: String(!isMainThreadCopy),
        },
      },
      directiveDCE: { target: 'JS' },
      worklet: { target: 'JS', filename, runtimePkg: '@lynx-solid/runtime' },
    })
    if (swc.errors.length > 0) {
      throw new Error(
        `[compileDomModule] SWC worklet transform failed for ${filename}: ${
          swc.errors.map(e => e.text).join('; ')}`,
      )
    }
    code = swc.code
    worklets = (swc.definesForWorklet ?? [])
      .filter(d => d.code.length > 0)
      .map((d) => {
        const call = extractSingleWorkletCall(d.code)
        if (!call) {
          throw new Error(
            `[compileDomModule] cannot extract worklet registration call for ${d.id} (${filename})`,
          )
        }
        return { id: d.id, code: call }
      })
    code = stripSharedImportAttributes(code)
  }

  return { code, templates, worklets }
}

// Module-level compile cache shared by the plugin setup pre-generation and
// the loaders: the same entry file is compiled once per identical
// (source, options) instead of twice (setup + loader). Keyed by filename +
// options with source-equality check, so watch-mode rebuilds recompute;
// results are shared — callers must not mutate them.
const compileCache = new Map<string, { source: string, result: DomCompileResult }>()

export function compileDomModuleCached(
  source: string,
  options: DomCompileOptions = {},
): DomCompileResult {
  const key = JSON.stringify({
    f: options.filename ?? '',
    m: options.moduleName ?? '',
    s: options.skipWorkletTransform ?? false,
    t: options.thread ?? 'background',
  })
  const hit = compileCache.get(key)
  if (hit && hit.source === source)
    return hit.result
  const result = compileDomModule(source, options)
  compileCache.set(key, { source, result })
  return result
}
