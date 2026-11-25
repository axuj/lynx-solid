/**
 * `$key` on an intrinsic element is compiler metadata (SSR/morph entity
 * identity), not a native attribute. Upstream dom-expressions bfc236f8 strips
 * it on the DOM path; Lynx has no morph, so the same rule keeps a literal
 * `$key` out of the attribute stream. Component `$key` is slot occurrence
 * identity and must survive.
 */
import { describe, expect, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'

describe('$key on intrinsic elements', () => {
  it('is stripped from a static element', () => {
    const { code, templates } = compileDomModule(
      `function App() { return <view $key="x" /> }`,
    )
    expect(templates[0]!.createCode).not.toContain('$key')
    expect(code).not.toContain('$key')
  })

  it('is stripped from a dynamic element', () => {
    const { code } = compileDomModule(
      `function App(props) { return <view $key={props.k} /> }`,
    )
    expect(code).not.toContain('$key')
    expect(code).not.toContain('setAttribute')
  })

  it('is stripped when the element has children', () => {
    const { code, templates } = compileDomModule(
      `function App() { return <view $key="x"><text>hi</text></view> }`,
    )
    expect(templates[0]!.createCode).not.toContain('$key')
    expect(code).not.toContain('$key')
  })

  it('survives on a component', () => {
    const { code } = compileDomModule(
      `function Comp(props) { return <view /> }
function App(props) { return <Comp $key={props.k} /> }`,
    )
    expect(code).toContain('$key')
  })
})
