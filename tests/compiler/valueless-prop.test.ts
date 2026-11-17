/**
 * A valueless `prop:` attribute means `prop:x={true}`, like a bare plain
 * attribute, instead of being dropped (ported from upstream solidjs/solid
 * #4196 / #4180).
 */
import { describe, expect, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'

const bare = compileDomModule(`const a = <view prop:checked />`)
const explicit = compileDomModule(`const a = <view prop:checked={true} />`)

describe('valueless prop attribute', () => {
  it('prop:checked ≡ prop:checked={true}', () => {
    expect(bare.code).toBe(explicit.code)
    expect(bare.code).toContain('"checked", true')
  })

  it('prop:active on a custom element keeps the property write', () => {
    const { code } = compileDomModule(`const a = <my-element prop:active />`)
    expect(code).toContain('"active", true')
  })

  it('an explicit false is not rewritten to true', () => {
    const { code } = compileDomModule(`const a = <view prop:checked={false} />`)
    expect(code).toContain('"checked", false')
  })
})
