/**
 * `children` attribute ≡ nested child (equivalence with the nested spelling).
 * Cherry-picked from upstream dom-expressions bba3db6c; upstream's own
 * fixture proves the same equivalence (staticChildren/foldedChildren share
 * one template). Promotion happens before the child pass, so both spellings
 * flow through the identical downstream path — by construction, not by luck.
 */
import { describe, expect, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'

describe('children attribute promotion', () => {
  it('children="..." ≡ nested text child', () => {
    const attr = compileDomModule(
      `function App() { return <view children="hello" /> }`,
    )
    const nested = compileDomModule(
      `function App() { return <view>hello</view> }`,
    )
    expect(attr.templates[0]!.createCode).toBe(nested.templates[0]!.createCode)
    expect(attr.templates[0]!.id).toBe(nested.templates[0]!.id)
    // guard rail: no stray `children` attribute leaks anywhere
    expect(attr.code).not.toContain('children')
  })

  it('children={const} ≡ nested text child', () => {
    const attr = compileDomModule(
      `const hello = "hello"
function App() { return <view children={hello} /> }`,
    )
    const nested = compileDomModule(
      `function App() { return <view>hello</view> }`,
    )
    expect(attr.templates[0]!.createCode).toBe(nested.templates[0]!.createCode)
    expect(attr.templates[0]!.id).toBe(nested.templates[0]!.id)
    expect(attr.code).not.toContain('setAttribute')
  })

  it('children={dynamic} ≡ nested dynamic child (both insert)', () => {
    const attr = compileDomModule(
      `function App(props: any) { return <view children={props.x} /> }`,
    )
    const nested = compileDomModule(
      `function App(props: any) { return <view>{props.x}</view> }`,
    )
    expect(attr.code).toBe(nested.code)
  })

  it('explicit JSX children win over the attribute', () => {
    const { templates } = compileDomModule(
      `function App() { return <view children="dropped"><text>kept</text></view> }`,
    )
    const t = templates[0]!
    expect(t.createCode).toContain('P.prop(e1,"text","kept")')
    expect(t.createCode).not.toContain('dropped')
  })
})
