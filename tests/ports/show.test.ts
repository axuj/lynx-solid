// @vitest-environment jsdom
/**
 * Ported from solid-web test/show.spec.tsx — Show control-flow behavior
 * through the fork pipeline: only-child text, DOM children, keyed /
 * non-keyed execution, callback children and fallback. isPending (transition
 * kernel) scenarios are out of scope for the host pipeline.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { runScene } from '../helpers/jsdom-scene'

// Ports tests poke engine globals by dynamic key — wide type on purpose.
const g = globalThis as Record<string, unknown>

let container: HTMLDivElement

function mount(): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  return container
}

afterEach(() => {
  for (const k of ['__setCount', '__setData', '__whenExecuted', '__childrenExecuted'])
    delete g[k]
  container?.remove()
})

function WRAP(inner: string, setup = ''): string {
  return `
import { createPageRoot, renderer } from '@lynx-solid/runtime'
import { createSignal, Show } from 'solid-js'
const [count, setCount] = createSignal(0)
;(globalThis as any).__setCount = setCount
${setup}
function App() {
  return <div>${inner}</div>
}
renderer.render(() => <App />, createPageRoot())
`
}

describe('show control flow (ported from solid-web show.spec)', () => {
  it('only-child text: toggles with the when signal', async () => {
    const { settle } = await runScene(WRAP(`
<Show when={count() >= 5}>{count()}</Show>
`), mount())
    const div = container.firstChild as HTMLElement
    expect(div.textContent).toBe('')
    ;(g.__setCount as (v: number) => void)(7)
    await settle()
    expect(div.textContent).toBe('7')
    ;(g.__setCount as (v: number) => void)(2)
    await settle()
    expect(div.textContent).toBe('')
  })

  it('dOM children: multiple nodes inside Show', async () => {
    const { settle } = await runScene(WRAP(`
<Show when={count() >= 5}>
  <span>{count()}</span>
  <span>counted</span>
</Show>
`), mount())
    const div = container.firstChild as HTMLElement
    expect(div.children).toHaveLength(0)
    ;(g.__setCount as (v: number) => void)(7)
    await settle()
    expect(div.children).toHaveLength(2)
    expect(div.children[0]!.textContent).toBe('7')
    expect(div.children[1]!.textContent).toBe('counted')
    ;(g.__setCount as (v: number) => void)(2)
    await settle()
    expect(div.children).toHaveLength(0)
  })

  it('non-keyed: when re-evaluates, children stay mounted across toggles', async () => {
    const { settle } = await runScene(WRAP(`
<Show when={whenFn()}>
  <span>{count()}</span>
  <span>counted</span>
</Show>
`, `
let whenExecuted = 0
function whenFn() {
  whenExecuted++
  globalThis.__whenExecuted = whenExecuted
  return count() >= 5
}
`), mount())
    const div = container.firstChild as HTMLElement
    expect(div.children).toHaveLength(0)
    ;(g.__setCount as (v: number) => void)(7)
    await settle()
    expect(div.children).toHaveLength(2)
    expect(div.children[0]!.textContent).toBe('7')
    expect(g.__whenExecuted).toBeGreaterThanOrEqual(2)
    ;(g.__setCount as (v: number) => void)(2)
    await settle()
    expect(div.children).toHaveLength(0)
    ;(g.__setCount as (v: number) => void)(7)
    await settle()
    expect(div.children).toHaveLength(2)
  })

  it('keyed: children remount on each key change', async () => {
    const mounts = 0
    g.__mounts = () => mounts
    const { settle } = await runScene(WRAP(`
<Show when={count() >= 5} keyed>
  <span>{(() => { globalThis.__keyedMounts = (globalThis.__keyedMounts ?? 0) + 1; return count() })()}</span>
</Show>
`), mount())
    const div = container.firstChild as HTMLElement
    expect(div.children).toHaveLength(0)
    ;(g.__setCount as (v: number) => void)(7)
    await settle()
    expect(div.children[0]!.textContent).toBe('7')
    ;(g.__setCount as (v: number) => void)(5)
    await settle()
    expect(div.children[0]!.textContent).toBe('5')
    expect(g.__keyedMounts).toBeGreaterThanOrEqual(2)
  })

  it('callback children: receives the resolved data value', async () => {
    const { settle } = await runScene(`
import { createPageRoot, renderer } from '@lynx-solid/runtime'
import { createSignal, Show } from 'solid-js'
const [data, setData] = createSignal<{ count: number } | undefined>(undefined)
;(globalThis as any).__setData = setData
function App() {
  return (
    <div>
      <Show when={data()}>
        {(d) => (
          <>
            <span>{d().count}</span>
            <span>counted</span>
          </>
        )}
      </Show>
    </div>
  )
}
renderer.render(() => <App />, createPageRoot())
`, mount())
    const div = container.firstChild as HTMLElement
    expect(div.children).toHaveLength(0)
    ;(g.__setData as (v: { count: number }) => void)({ count: 7 })
    await settle()
    expect(div.children).toHaveLength(2)
    expect(div.children[0]!.textContent).toBe('7')
    expect(div.children[1]!.textContent).toBe('counted')
    ;(g.__setData as (v: { count: number }) => void)({ count: 5 })
    await settle()
    expect(div.children[0]!.textContent).toBe('5')
  })

  it('fallback: renders when the condition is false', async () => {
    const { settle } = await runScene(WRAP(`
<Show when={count() >= 5} fallback={<span>Too Low</span>}>
  <span>{count()}</span>
</Show>
`), mount())
    const div = container.firstChild as HTMLElement
    expect(div.children[0]!.textContent).toBe('Too Low')
    ;(g.__setCount as (v: number) => void)(7)
    await settle()
    expect(div.children[0]!.textContent).toBe('7')
    ;(g.__setCount as (v: number) => void)(2)
    await settle()
    expect(div.children[0]!.textContent).toBe('Too Low')
  })
})
