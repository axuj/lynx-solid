/**
 * A returned element's setup belongs inside the braceless `if`, `else` or
 * loop body that returns it: built only when that branch runs, and inside the
 * loop that binds its variables (ported from upstream solidjs/solid #4450).
 *
 * The compiled module is executed against a stub runtime whose `effect`
 * evaluates its compute immediately, so setup that escapes its branch throws.
 */
import { describe, expect, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'

const SOURCE = `
function Branch(p: any) {
  if (p.list) return <text>{p.list.join(', ')}</text>
  else return <view>{p.empty}</view>
}
function Loop(p: any) {
  for (const item of p.items) return <text>{item.name}</text>
  return null
}
function Nested(p: any) {
  for (const row of p.rows)
    for (const cell of row) if (cell) return <text>{cell.name}</text>
  return null
}
`

const runtime = {
  registerTemplate: () => () => ({}),
  effect: (compute: () => unknown, apply?: (value: unknown, prev: unknown) => void) => {
    apply?.(compute(), undefined)
  },
  setAttribute: () => {},
  insert: (_el: unknown, value: unknown) => {
    if (typeof value === 'function')
      value()
  },
  insertNode: () => {},
  createTextNode: (value: unknown) => value,
}

/** Strip ESM imports and bind them to the stub runtime instead. */
function bindImports(code: string): string {
  return code.replace(
    /^import \{([^}]+)\} from "[^"]+";\s*$/gm,
    (_match, specifiers: string) => {
      const declarations = specifiers
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map((specifier) => {
          const [name, alias] = specifier.split(/\s+as\s+/)
          return `${alias ?? name} = __rt.${name}`
        })
      return `const ${declarations.join(', ')};`
    },
  )
}

const { code } = compileDomModule(SOURCE)
const factory = new Function( // eslint-disable-line no-new-func -- the test runs the generated module
  '__rt',
  `${bindImports(code)}
return { Branch, Loop, Nested }`,
) as (rt: typeof runtime) => {
  Branch: (props: { list?: string[], empty?: unknown }) => unknown
  Loop: (props: { items?: { name: string }[] }) => unknown
  Nested: (props: { rows?: (null | { name: string })[][] }) => unknown
}
const { Branch, Loop, Nested } = factory(runtime)

describe('braceless return setup', () => {
  it('keeps setup inside the if / else branches', () => {
    const ifAt = code.indexOf('if (p.list)')
    expect(ifAt).toBeGreaterThan(-1)
    expect(code.indexOf('_$effect', ifAt)).toBeGreaterThan(ifAt)
    expect(code).toContain('if (p.list) {')
    expect(code).toContain('} else {')
  })

  it('an untaken branch builds nothing', () => {
    expect(() => Branch({ empty: 'none' })).not.toThrow()
    expect(() => Branch({ list: ['a', 'b'] })).not.toThrow()
  })

  it('a loop body reads its loop variable in scope', () => {
    expect(() => Loop({ items: [] })).not.toThrow()
    expect(() => Loop({ items: [{ name: 'a' }] })).not.toThrow()
    expect(() => Nested({ rows: [[null, { name: 'b' }]] })).not.toThrow()
  })
})
