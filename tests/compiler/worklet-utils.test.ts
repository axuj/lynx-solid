/**
 * Shared-import grammar tests (`with { runtime: 'shared' }`).
 *
 * A2 contract: extractSharedImports re-emits the import **with the
 * attribute intact** so the bundler's `rules[].with: { runtime: 'shared' }`
 * can pass the target through worklet-mt-loader (full exports, multi-hop).
 *
 * Regression: the specifier matcher used `.+?`, which never crosses `\n`,
 * so a hand-written multi-line shared import (elk Sheet's 9-line gesture
 * import) was silently missed — `shared=0`, the LEPUS fallback never ran,
 * and the shared-dependent worklets (touchmove/touchend) were absent from
 * the MT bundle, making the sheet undraggable with zero errors.
 */

import { describe, expect, it } from 'vitest'
import {
  extractImportSpecifiers,
  extractSharedImports,
  stripSharedImportAttributes,
} from '../../packages/compiler/src/worklet-utils'

/** Attribute must survive so rule.with can match the target module. */
const SHARED_ATTR = ` with { runtime: 'shared' }`

const MULTI_LINE = `import {
  resolveSheetDrag,
  sheetDismissThreshold,
  smoothSheetVelocity,
} from './gesture' with { runtime: 'shared' }
`

const SINGLE_LINE = `import { a } from './x' with { runtime: 'shared' };
`

const MULTI_LINE_ATTR = `import { a } from './x' with {
  runtime: 'shared',
};
`

describe('shared import grammar', () => {
  it('extractSharedImports catches multi-line specifiers', () => {
    const out = extractSharedImports(MULTI_LINE)
    expect(out).toContain('./gesture')
    expect(out).toContain('resolveSheetDrag')
    expect(out).toContain(SHARED_ATTR)
    expect(out).not.toContain('!!')
  })

  it('extractSharedImports still catches single-line and multi-line attributes', () => {
    expect(extractSharedImports(SINGLE_LINE)).toContain('./x')
    expect(extractSharedImports(MULTI_LINE_ATTR)).toContain('./x')
    expect(extractSharedImports(SINGLE_LINE)).toContain(SHARED_ATTR)
  })

  it('extractSharedImports ignores plain imports', () => {
    expect(extractSharedImports(`import { a } from './x';\n`)).toBe('')
  })

  it('stripSharedImportAttributes keeps the import for multi-line specifiers', () => {
    const out = stripSharedImportAttributes(MULTI_LINE)
    expect(out).toContain(`from './gesture'`)
    expect(out).not.toContain(`runtime:`)
  })

  // Bare side-effect form: `import './x' with { runtime: 'shared' }`.
  // Regression: the grammar required a `from` clause, so bare shims were
  // silently dropped — no re-emit, no strip, module dead in the MT graph
  // with zero errors (motion shim-entry incident).
  it('extractSharedImports catches the bare side-effect form', () => {
    const out = extractSharedImports(`import './shim-entry' with { runtime: 'shared' };\n`)
    expect(out).toContain(`'./shim-entry'${SHARED_ATTR}`)
    expect(out).not.toContain('!!')
  })

  it('extractSharedImports preserves source order across mixed forms', () => {
    const out = extractSharedImports(
      `import './shim-entry' with { runtime: 'shared' };\n`
      + `import { a } from './x' with { runtime: 'shared' };\n`,
    )
    expect(out.indexOf('shim-entry')).toBeLessThan(out.indexOf('./x'))
  })

  it('extractSharedImports does not merge a bare import into a later from-form', () => {
    const out = extractSharedImports(
      `import './shim-entry' with { runtime: 'shared' };\n`
      + `import { a } from './x' with { runtime: 'shared' };\n`,
    )
    expect(out).toContain(`{ a } from './x'${SHARED_ATTR}`)
    expect(out.split('\n').filter(Boolean)).toHaveLength(2)
  })

  it('extractSharedImports ignores bare imports without the attribute', () => {
    expect(extractSharedImports(`import './x';\n`)).toBe('')
  })

  it('extractSharedImports ignores commented-out shared imports', () => {
    expect(extractSharedImports(`// import './x' with { runtime: 'shared' };\n`)).toBe('')
  })

  it('stripSharedImportAttributes strips the bare form to a plain import', () => {
    const out = stripSharedImportAttributes(`import './shim-entry' with { runtime: 'shared' };\n`)
    expect(out).toContain(`import './shim-entry';`)
    expect(out).not.toContain(`runtime:`)
  })

  // A `from` match must never span statements to reach a later attribute:
  // the plain import below has no `with` clause and must survive verbatim,
  // while both shared imports are re-emitted independently.
  it('extractSharedImports never spans a plain import to reach a later attribute', () => {
    const out = extractSharedImports(
      `import { createSignal } from 'solid-js'\n`
      + `import './shim-entry' with { runtime: 'shared' };\n`
      + `import { a } from './x' with { runtime: 'shared' };\n`,
    )
    expect(out).not.toContain('@lynx-solid/runtime')
    expect(out).toContain(`import './shim-entry'${SHARED_ATTR};`)
    expect(out).toContain(`{ a } from './x'${SHARED_ATTR}`)
    expect(out.split('\n').filter(Boolean)).toHaveLength(2)
  })
})

describe('barrel roots (`export … from` with shared)', () => {
  // The upstream regex grammar only knew `import` forms — a barrel-style
  // root edge fell through extractSharedImports, the shell dropped it, and
  // the link died with `module has no exports`. The AST reader covers every
  // edge node type by construction; export roots re-emit as BARE edges so
  // the shell keeps its no-exports invariant while the dependency survives.
  it('extractSharedImports re-emits export-from roots as bare edges', () => {
    const out = extractSharedImports(
      `export { a } from './x' with { runtime: 'shared' };\n`
      + `export * from './y' with { runtime: 'shared' };\n`
      + `export * as ns from './z' with { runtime: 'shared' };\n`,
    )
    expect(out).toContain(`import './x'${SHARED_ATTR};`)
    expect(out).toContain(`import './y'${SHARED_ATTR};`)
    expect(out).toContain(`import './z'${SHARED_ATTR};`)
    expect(out).not.toContain('export')
  })

  it('extractSharedImports ignores export-from edges without the attribute', () => {
    expect(extractSharedImports(`export { a } from './x';\n`)).toBe('')
  })

  it('stripSharedImportAttributes strips the export-from form', () => {
    const out = stripSharedImportAttributes(`export { a } from './x' with { runtime: 'shared' };\n`)
    expect(out).toBe(`export { a } from './x';\n`)
  })
})

describe('extractImportSpecifiers (AST edge reader)', () => {
  it('collects from-edges before bare edges, deduplicates, skips attribute edges', () => {
    const out = extractImportSpecifiers(
      `import './gate'\n`
      + `import { a } from './x'\n`
      + `export { b } from './y'\n`
      + `export * from './y2'\n`
      + `import { c } from './shared' with { runtime: 'shared' }\n`
      + `import 'pkg'\n`
      + `import './gate'\n`,
    )
    expect(out).toEqual(['./x', './y', './y2', './gate', 'pkg'])
  })

  it('ignores import-like text inside strings and comments', () => {
    const out = extractImportSpecifiers(
      `// import './in-comment'\n`
      + `const s = "import './in-string'"\n`
      + `import { a } from './real'\n`,
    )
    expect(out).toEqual(['./real'])
  })
})
