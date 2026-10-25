import { readFile } from 'node:fs/promises'
/**
 * The Lynx built-in compile-time macros, per copy.
 *
 * `__MAIN_THREAD__` / `__BACKGROUND__` (and their deprecated aliases
 * `__LEPUS__` / `__JS__`) are compile-time constants: the transform folds them
 * to a literal and the dead branch is removed. The polarity depends on which
 * copy of the module is being compiled:
 *
 * - background copy → `__MAIN_THREAD__` false, `__BACKGROUND__` true
 * - main-thread copy → `__MAIN_THREAD__` true, `__BACKGROUND__` false
 *
 * We keep the table in three places (the background compiler, the shared-chain
 * macro pass and the main-thread worklet loader). Upstream ReactLynx keeps the
 * same shape — two independent literal tables in
 * `packages/webpack/react-webpack-plugin/src/loaders/options.ts` (MT and BG)
 * plus two more copies as Rust `Default`s in the define-DCE crate — and it has
 * **no** test asserting that those copies agree (its
 * `packages/react/transform/__test__/defines.spec.js` covers the collected
 * snapshot/worklet defines, not the table; the closest thing is an e2e
 * assertion per layer). This file is stricter than upstream: it pins the
 * VALUES and the FOLDING, so our copies cannot drift apart (a wrong polarity
 * silently changes what an app does per thread).
 */
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { compileDomModule } from '../../packages/compiler/src/dom-compile'

const require = createRequire(import.meta.url)

/**
 * The shared-chain macro pass is a plain loader function: call it with a
 * loader-ish context and read the transformed source back.
 */
function foldWithMtMacro(source: string): string {
  const loader = require('../../packages/compiler/mt-macro.cjs') as (
    this: { resourcePath: string },
    source: string,
  ) => string
  return loader.call({ resourcePath: 'test.tsx' }, source)
}

describe('built-in thread macros', () => {
  it('background copy: __MAIN_THREAD__ is false, __BACKGROUND__ is true', () => {
    const out = compileDomModule(`
      if (__MAIN_THREAD__) { globalThis.__pick = 'mt' } else { globalThis.__pick = 'bg' }
      if (__BACKGROUND__) { globalThis.__bg = true }
    `).code

    expect(out).toContain('bg')
    expect(out).not.toContain('mt')
    expect(out).not.toContain('__MAIN_THREAD__')
    expect(out).not.toContain('__BACKGROUND__')
  })

  it('main-thread copy: __MAIN_THREAD__ is true, __BACKGROUND__ is false', () => {
    const out = foldWithMtMacro(`
      if (__MAIN_THREAD__) { globalThis.__pick = 'mt' } else { globalThis.__pick = 'bg' }
      if (__BACKGROUND__) { globalThis.__bg = true }
    `)

    expect(out).toContain('mt')
    expect(out).not.toContain('bg')
    expect(out).not.toContain('__MAIN_THREAD__')
    expect(out).not.toContain('__BACKGROUND__')
  })

  it('the deprecated aliases keep the same polarity', () => {
    const bg = compileDomModule(`
      if (__LEPUS__) { globalThis.__a = 'mt' } else { globalThis.__a = 'bg' }
    `).code
    expect(bg).toContain('bg')

    const mt = foldWithMtMacro(`
      if (__LEPUS__) { globalThis.__a = 'mt' } else { globalThis.__a = 'bg' }
    `)
    expect(mt).toContain('mt')
  })

  it('IFR main-thread body (compileDomModule thread option) uses the MT table', () => {
    // The IFR MT body is emitted by worklet-mt-loader's `enableIfr` branch
    // through compileDomModule, a third entry point into the same table.
    // Before the `thread` option existed it hardcoded the background values,
    // so `__MAIN_THREAD__` read false on the one thread it describes — app
    // guards (`if (__MAIN_THREAD__)`) were folded away on the MT copy.
    const out = compileDomModule(`
      if (__MAIN_THREAD__) { globalThis.__pick = 'mt' } else { globalThis.__pick = 'bg' }
      if (__BACKGROUND__) { globalThis.__bg = true }
    `, { thread: 'main-thread' }).code

    expect(out).toContain('mt')
    expect(out).not.toContain('bg')
    expect(out).not.toContain('__MAIN_THREAD__')
    expect(out).not.toContain('__BACKGROUND__')
  })

  it('the worklet loader pins the MT table for its LEPUS recompile', async () => {
    // worklet-mt-loader carries its own define map for the LEPUS recompile of
    // shared-only worklets. Pin its polarity here so a further copy cannot
    // drift either. (The IFR full body uses compileDomModule above.)
    const text = await readFile(
      new URL('../../packages/plugin/src/worklet-mt-loader.ts', import.meta.url),
      'utf8',
    )
    expect(text).toContain('__MAIN_THREAD__: \'true\'')
    expect(text).toContain('__BACKGROUND__: \'false\'')
  })
})
