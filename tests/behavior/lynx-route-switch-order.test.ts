/**
 * Repro: route switch (non-silent) renders a page whose static skeleton
 *  sits between dynamic siblings — assert MT tree order + dump op frames.
 */
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'
import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetLynxTemplateState } from '../../packages/runtime/src/background/lynx-template'
import { resetMainThreadRefState } from '../../packages/runtime/src/background/main-thread-ref'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { registerSkeleton } from '../../packages/runtime/src/main-thread/skeleton-registry'
import { flushPromises } from '../helpers/async'
import { installFakePapi } from '../helpers/fake-papi'
import '../../packages/runtime/src/main-thread/index'

const g = globalThis

const SRC = `
import { render } from '@lynx-solid/runtime'
import { Show, createSignal } from 'solid-js'
const [route, setRoute] = createSignal('home')
;(globalThis as any).__setRoute = setRoute
function Header() {
  return <view class="header"><text>H</text></view>
}
function PageList() {
  return <list class="thelist"><list-item><text>L</text></list-item></list>
}
function HomePage() {
  return (
    <view class="page">
      <text class="home-body">home</text>
    </view>
  )
}
function ExplorePage() {
  return (
    <view class="page">
      <Header />
      <view class="tabs"><text>T</text></view>
      <Show when={route() === 'explore'}>
        <text class="intro">I</text>
      </Show>
      <PageList />
    </view>
  )
}
function App() {
  return (
    <Show when={route() === 'home'} fallback={<ExplorePage />}>
      <HomePage />
    </Show>
  )
}
render(() => <App />)
`

describe('route switch: skeleton between dynamic siblings (non-silent)', () => {
  it('keeps JSX child order after switching pages', async () => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
    resetLynxTemplateState()
    resetMainThreadRefState()
    resetApplyOpsState()

    const scene = compileDomModule(SRC)
    const host = installFakePapi()
    resetApplyOpsState()
    g.renderPage?.()
    for (const t of scene.templates) {
      // eslint-disable-next-line no-eval
      registerSkeleton(t.id, eval(`(${t.createCode})`))
    }

    const received: unknown[][] = []
    const opLog: string[] = []
    setOpsExecutor((ops) => {
      received.push(ops)
      for (let i = 0; i < ops.length; i += 2)
        opLog.push(`op${ops[i]}:${JSON.stringify(ops.slice(i + 1, i + 5)).slice(0, 80)}`)
    })
    const file = fileURLToPath(new URL('../tmp-lynx-switch.mjs', import.meta.url))
    writeFileSync(
      file,
      scene.code
        .replaceAll('@lynx-solid/runtime/lynx-template', '../packages/runtime/src/background/lynx-template.ts')
        .replaceAll('@lynx-solid/runtime', '../packages/runtime/src/index.ts'),
    )
    try {
      await import(pathToFileURL(file).href)
      await flushPromises()
    }
    finally {
      rmSync(file, { force: true })
    }
    for (const batch of received)
      applyOps(batch)

    // Switch to explore (non-silent reactive update)
    received.length = 0
    opLog.length = 0
    ;(globalThis as { __setRoute?: (v: string) => void }).__setRoute?.('explore')
    await flushPromises()

    for (const batch of received)
      applyOps(batch)

    const page = (host.root.children as any[]).find((c: any) => c.attrs?.class === 'page')
    const kids = ((page as any)?.children ?? []).map((c: any) => `${c.type}|${c.attrs?.class ?? ''}`)
    const labels = kids.map((k: string) => k.split('|')[1])
    expect(labels.indexOf('header')).toBeGreaterThanOrEqual(0)
    expect(labels.indexOf('header')).toBeLessThan(labels.indexOf('tabs'))
    expect(labels.indexOf('tabs')).toBeLessThan(labels.indexOf('thelist'))
  })
})
