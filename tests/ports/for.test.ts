// @vitest-environment jsdom
/**
 * Ported from solid-web test/for.spec.tsx — keyed For control flow:
 * add/remove/swap/rotate/reverse/replace, fragment & array row children,
 * fallback, undefined rows and index params. Each official `apply`
 * round-trip (set → flush → assert → restore) maps to set → settle →
 * assert → restore.
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
  for (const k of ['__setList', '__setItems'])
    delete g[k]
  container?.remove()
})

function WRAP(inner: string, setup = ''): string {
  return `
import { createPageRoot, renderer } from '@lynx-solid/runtime'
import { createSignal, For } from 'solid-js'
const [list, setList] = createSignal<string[]>([])
;(globalThis as any).__setList = setList
${setup}
function App() {
  return <div>${inner}</div>
}
renderer.render(() => <App />, createPageRoot())
`
}

const ORIG = ['a', 'b', 'c', 'd']

describe('for control flow (ported from solid-web for.spec)', () => {
  it('only child rows: missing/swap/rotate/reverse/replace', async () => {
    const { settle } = await runScene(WRAP(`
<For each={list()}>{item => item}</For>
`), mount())
    const div = container.firstChild as HTMLElement
    const apply = async (arr: string[]) => {
      ;(g.__setList as (v: string[]) => void)(arr)
      await settle()
      expect(div.textContent).toBe(arr.join(''))
      ;(g.__setList as (v: string[]) => void)(ORIG)
      await settle()
      expect(div.textContent).toBe('abcd')
    }
    await apply(['b', 'c', 'd'])
    await apply(['a', 'c', 'd'])
    await apply(['a', 'b', 'c'])
    await apply(['c', 'd'])
    await apply(['a', 'd'])
    await apply(['b', 'c'])
    await apply(['a'])
    await apply(['d'])
    await apply([])
    await apply(['b', 'a', 'c', 'd'])
    await apply(['d', 'b', 'c', 'a'])
    await apply(['b', 'c', 'd', 'a'])
    await apply(['d', 'a', 'b', 'c'])
    await apply(['d', 'c', 'b', 'a'])
    await apply(['e', 'f', 'g', 'h'])
  })

  it('rows inserted before a preceding sibling (marker anchor)', async () => {
    const { settle } = await runScene(WRAP(`
<For each={list()}>{item => item}</For>z
`), mount())
    const div = container.firstChild as HTMLElement
    const apply = async (arr: string[]) => {
      ;(g.__setList as (v: string[]) => void)(arr)
      await settle()
      expect(div.textContent).toBe(`${arr.join('')}z`)
      ;(g.__setList as (v: string[]) => void)(ORIG)
      await settle()
      expect(div.textContent).toBe('abcdz')
    }
    await apply(['b', 'c', 'd'])
    await apply(['a', 'c'])
    await apply(['b', 'a', 'c', 'd'])
    await apply(['b', 'c', 'd', 'a'])
    await apply(['d', 'c', 'b', 'a'])
    await apply(['e', 'f', 'g'])
  })

  it('fragment row children: each row renders two nodes', async () => {
    const { settle } = await runScene(WRAP(`
<For each={list()}>
  {item => <>{item}{item}</>}
</For>
`), mount())
    const div = container.firstChild as HTMLElement
    ;(g.__setList as (v: string[]) => void)(ORIG)
    await settle()
    expect(div.textContent).toBe('aabbccdd')
    const apply = async (arr: string[]) => {
      ;(g.__setList as (v: string[]) => void)(arr)
      await settle()
      expect(div.textContent).toBe(arr.map(p => `${p}${p}`).join(''))
      ;(g.__setList as (v: string[]) => void)(ORIG)
      await settle()
      expect(div.textContent).toBe('aabbccdd')
    }
    await apply(['b', 'c', 'd'])
    await apply(['a', 'd'])
    await apply([])
    await apply(['b', 'a', 'c', 'd'])
    await apply(['d', 'a', 'b', 'c'])
    await apply(['d', 'c', 'b', 'a'])
    await apply(['e', 'f', 'g', 'h'])
  })

  it('array row children: each row renders two nodes', async () => {
    const { settle } = await runScene(WRAP(`
<For each={list()}>{item => [item, item]}</For>
`), mount())
    const div = container.firstChild as HTMLElement
    ;(g.__setList as (v: string[]) => void)(ORIG)
    await settle()
    expect(div.textContent).toBe('aabbccdd')
    const apply = async (arr: string[]) => {
      ;(g.__setList as (v: string[]) => void)(arr)
      await settle()
      expect(div.textContent).toBe(arr.map(p => `${p}${p}`).join(''))
      ;(g.__setList as (v: string[]) => void)(ORIG)
      await settle()
      expect(div.textContent).toBe('aabbccdd')
    }
    await apply(['b', 'c', 'd'])
    await apply(['a', 'c'])
    await apply([])
    await apply(['c', 'b', 'a', 'd'])
    await apply(['d', 'c', 'b', 'a'])
  })

  it('fallback: renders when the list is empty', async () => {
    const { settle } = await runScene(WRAP(`
<For each={list()} fallback={"Empty"}>
  {item => item}
</For>
`), mount())
    const div = container.firstChild as HTMLElement
    expect(div.textContent).toBe('Empty')
    ;(g.__setList as (v: string[]) => void)(ORIG)
    await settle()
    expect(div.textContent).toBe('abcd')
    ;(g.__setList as (v: string[]) => void)([])
    await settle()
    expect(div.textContent).toBe('Empty')
  })

  it('rows mapping to undefined render nothing', async () => {
    const { settle } = await runScene(WRAP(`
<For each={list()}>{item => undefined}</For>
`), mount())
    const div = container.firstChild as HTMLElement
    expect(div.textContent).toBe('')
    ;(g.__setList as (v: string[]) => void)(ORIG)
    await settle()
    expect(div.textContent).toBe('')
    ;(g.__setList as (v: string[]) => void)([])
    await settle()
    expect(div.textContent).toBe('')
  })

  it('index params: rows re-key on reorder', async () => {
    const { settle } = await runScene(WRAP(`
<For each={list()} fallback={"Hi"}>
  {(item, i) => <span>{item + i()}</span>}
</For>
`), mount())
    const div = container.firstChild as HTMLElement
    expect(div.textContent).toBe('Hi')
    const apply = async (arr: string[]) => {
      ;(g.__setList as (v: string[]) => void)(arr)
      await settle()
      expect(div.textContent).toBe(arr.map((p, i) => `${p}${i}`).join(''))
    }
    await apply(ORIG)
    await apply(['b', 'c', 'd', 'a'])
    await apply(['c', 'd', 'a'])
    await apply(['c', 'b', 'd', 'a'])
    ;(g.__setList as (v: string[]) => void)([])
    await settle()
    expect(div.textContent).toBe('Hi')
    await apply(['a'])
  })
})
