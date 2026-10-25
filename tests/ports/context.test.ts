// @vitest-environment jsdom
/**
 * Ported from solid-web test/context.spec.tsx — Provider/useContext
 * propagation through the fork pipeline (single/multi/conditional/dynamic
 * provider children).
 */

import { afterEach, describe, expect, it } from 'vitest'

import { runScene } from '../helpers/jsdom-scene'

let container: HTMLDivElement

function mount(): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  return container
}

afterEach(() => {
  container?.remove()
})

function SRC(body: string, _cond = false): string {
  return `
import { createPageRoot, renderer } from '@lynx-solid/runtime'
import { createContext, useContext, Show } from 'solid-js'
const ThemeContext = createContext('light')
const Component = () => {
  const theme = useContext(ThemeContext)
  return <div>{theme}</div>
}
const CondComponent = () => {
  const theme = useContext(ThemeContext)
  return (
    <Show when={true}>
      <div>{theme}</div>
    </Show>
  )
}
${body}
renderer.render(() => <App />, createPageRoot())
`
}

describe('context propagation (ported from solid-web context.spec)', () => {
  it('single provider child', async () => {
    await runScene(SRC(`
function App() {
  return <ThemeContext value="dark"><Component /></ThemeContext>
}
`), mount())
    expect(container.firstChild!.textContent).toBe('dark')
  })

  it('single conditional provider child', async () => {
    await runScene(SRC(`
function App() {
  return <ThemeContext value="dark"><CondComponent /></ThemeContext>
}
`), mount())
    expect(container.firstChild!.textContent).toBe('dark')
  })

  it('multi provider child', async () => {
    await runScene(SRC(`
function App() {
  return (
    <ThemeContext value="dark">
      <div>Hi</div>
      <Component />
    </ThemeContext>
  )
}
`), mount())
    expect(container.children[0]!.textContent).toBe('Hi')
    expect(container.children[1]!.textContent).toBe('dark')
  })

  it('multi conditional provider child', async () => {
    await runScene(SRC(`
function App() {
  return (
    <ThemeContext value="dark">
      <div>Hi</div>
      <CondComponent />
    </ThemeContext>
  )
}
`), mount())
    expect(container.children[0]!.textContent).toBe('Hi')
    expect(container.children[1]!.textContent).toBe('dark')
  })

  it('dynamic multi provider child', async () => {
    await runScene(SRC(`
function App() {
  const child = () => <Component />
  return (
    <ThemeContext value="dark">
      <div>Hi</div>
      {child()}
    </ThemeContext>
  )
}
`), mount())
    expect(container.children[0]!.textContent).toBe('Hi')
    expect(container.children[1]!.textContent).toBe('dark')
  })

  it('dynamic multi conditional provider child', async () => {
    await runScene(SRC(`
function App() {
  const child = () => <CondComponent />
  return (
    <ThemeContext value="dark">
      <div>Hi</div>
      {child()}
    </ThemeContext>
  )
}
`), mount())
    expect(container.children[0]!.textContent).toBe('Hi')
    expect(container.children[1]!.textContent).toBe('dark')
  })
})
