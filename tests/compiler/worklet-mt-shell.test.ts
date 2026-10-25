/**
 * MT rule-exclude migration regression tests.
 *
 * Bootstrap modules (main-thread/* + internal/*) never reach worklet-mt-loader
 * (rule-level `isBootstrapModule` exclude in `packages/plugin/src/index.ts`); everything
 * the loader sees is user-side and must degrade to an import shell when it
 * carries no templates, worklets, or shared imports. These tests pin the
 * loader half of that contract at module granularity:
 *
 * 1. three-no framework user-side files (src/index.ts, background/*,
 *    routeTree.gen.ts) shell — no live cross-module bindings leak into MT;
 * 2. real worklet files keep registrations and get the `@lynx-solid/runtime`
 *    → main-thread/runtime specifier rewrite;
 * 3. bootstrap files would also shell if they ever reached the loader
 *    (documents that intact MT execution comes from the rule exclude,
 *    not from the loader).
 */

import type { LoaderContext } from '@rspack/core'
import type { WorkletLoaderMTOptions } from '../../packages/plugin/src/worklet-mt-loader'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import workletMtLoader from '../../packages/plugin/src/worklet-mt-loader'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(HERE, '../..')
const SRC_ROOT = path.resolve(PKG, 'packages/runtime/src')

function runLoader(resourcePath: string, source: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const ctx = {
      resourcePath,
      context: path.dirname(resourcePath),
      rootContext: PKG,
      cacheable: (): void => {},
      emitError: (): void => {},
      async: () => (err: unknown, result?: string): void => {
        if (err)
          reject(err instanceof Error ? err : new Error(String(err)))
        else resolve(result ?? '')
      },
      getOptions: (): WorkletLoaderMTOptions => ({
        srcRoot: SRC_ROOT,
        includeWorkletPackages: [],
      }),
      getResolve: () => async (_context: string, request: string): Promise<string | null> => {
        if (request.startsWith('.'))
          return path.resolve(path.dirname(resourcePath), request)
        return null
      },
    }
    // as: cross-boundary, no narrowing possible — test double mimics the bundler-injected LoaderContext and implements only the subset the loader actually consumes
    workletMtLoader.call(ctx as unknown as LoaderContext<WorkletLoaderMTOptions>, source)
  })
}

function readPkg(rel: string): { resourcePath: string, source: string } {
  const resourcePath = path.resolve(PKG, rel)
  return { resourcePath, source: readFileSync(resourcePath, 'utf8') }
}

describe('worklet-mt-loader shell contract', () => {
  it('src/index.ts (BG entry, three-no) shells: no live re-exports', async () => {
    const { resourcePath, source } = readPkg('packages/runtime/src/index.ts')
    const out = await runLoader(resourcePath, source)
    expect(out).not.toMatch(/export[\s{*]/)
    expect(out).not.toContain('ShadowElement')
    // side-effect edge survives so the dependency graph stays connected
    // (queueMicrotask shim — the core-js polyfill import is gone)
    expect(out).toContain('queue-microtask-shim')
  })

  it('packages/runtime/src/background/entry.ts shells: no BG bridge identifiers', async () => {
    const { resourcePath, source } = readPkg('packages/runtime/src/background/entry.ts')
    const out = await runLoader(resourcePath, source)
    expect(out).not.toMatch(/export[\s{*]/)
    expect(out).not.toContain('installBridge')
    expect(out).not.toContain('initBackground')
  })

  it('routeTree.gen.ts shells: no Route live binding (TanStack failure mode)', async () => {
    const { resourcePath, source } = readPkg('examples/elk/src/routeTree.gen.ts')
    const out = await runLoader(resourcePath, source)
    expect(out).not.toMatch(/export[\s{*]/)
    // named binding must be gone; side-effect shell keeps only module strings
    expect(out).not.toMatch(/import\s*\{[^}]*\}/)
    expect(out).not.toContain('.update(')
  })

  it('Sheet shared import re-emits cleanly without dragging neighboring imports', async () => {
    const { resourcePath, source } = readPkg('examples/elk/src/components/sheet/Sheet.tsx')
    const out = await runLoader(resourcePath, source)
    expect(out).toMatch(/registerWorklet(Internal)?/)
    // A2: re-emit keeps the import attribute so rules[].with can pass the
    // target through worklet-mt-loader (no !! single-hop chain).
    expect(out).toContain(`from './gesture' with { runtime: 'shared' }`)
    expect(out).not.toContain('builtin:swc-loader!')
    // Worklet bodies resolve `runOnBackground` via the MT global (the
    // bootstrap provides it), so no `@lynx-solid/runtime` specifier
    // survives anywhere and there is nothing to rewrite.
    expect(out).not.toContain(`from '@lynx-solid/runtime'`)
    expect(out).not.toContain(`from "@lynx-solid/runtime"`)
    expect(out).not.toMatch(/main-thread[\\/]+runtime/)
  })

  it('bootstrap files shell at loader level (intact execution comes from rule exclude)', async () => {
    const { resourcePath, source } = readPkg('packages/runtime/src/main-thread/index.ts')
    const out = await runLoader(resourcePath, source)
    expect(out).not.toContain('renderPage')
    expect(out).not.toContain('lynxSolidApplyOps')
  })

  // A barrel-style root edge (`export … from … with shared`) used to fall
  // through extractSharedImports' import-only grammar: the shell dropped the
  // edge, the shared root rule (rule.with) never saw it, and the link died
  // with `module has no exports`. The AST reader re-emits it — collapsed to
  // a BARE edge so the shell keeps its no-exports invariant while the
  // dependency survives for the rule to match.
  it('barrel root (`export … from` with shared) re-emits as a bare edge', async () => {
    const resourcePath = path.resolve(PKG, 'examples/motion/src/BarrelCase.tsx')
    const source = [
      `export { animateEl } from '../adapters' with { runtime: 'shared' }`,
      `export function handler() {`,
      `  'main thread'`,
      `  return 1`,
      `}`,
      '',
    ].join('\n')
    const out = await runLoader(resourcePath, source)
    expect(out).toContain(`import '../adapters' with { runtime: 'shared' };`)
    expect(out).not.toContain('export')
  })
})
