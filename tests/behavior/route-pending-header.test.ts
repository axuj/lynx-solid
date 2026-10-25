/**
 * Repro: route param change while the previous async fetch is still in flight
 * (or a new one starts pending) — the page header (outside the boundary) must
 * update immediately, before settle.
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
import { registerSkeleton } from '../../packages/runtime/src/main-thread/skeleton-registry'
import { flushPromises } from '../helpers/async'

const SRC = `
import { render } from '@lynx-solid/runtime'
import { Loading, Match, Switch, createMemo, createSignal } from 'solid-js'

const [kind, setKind] = createSignal<'home' | 'local'>('home')
;(globalThis as any).__setKind = setKind

let release
let gate = new Promise<string[]>(r => { release = r })
;(globalThis as any).__resetGate = () => { gate = new Promise<string[]>(r => { release = r }) }
;(globalThis as any).__release = () => release(['post'])

function Page(props: { kind: () => string }) {
  const timeline = createMemo(async () => {
    void props.kind()
    return await gate
  })
  const titles = { home: 'Home Timeline', local: 'Local Timeline' } as const
  return (
    <view class="page">
      <text class="header">{titles[props.kind()]}</text>
      <Loading fallback={<text class="spinner">loading…</text>}>
        <text class="feed">{timeline().join(',')}</text>
      </Loading>
    </view>
  )
}

function App() {
  return (
    <view class="app-root">
      <Switch>
        <Match when={true}>
          <Page kind={kind} />
        </Match>
      </Switch>
    </view>
  )
}
render(() => <App />)
`

describe('route param change during pending: header updates before settle', () => {
  it('SET_TEXT for the new title ships while the memo is still pending', async () => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
    resetLynxTemplateState()
    resetMainThreadRefState()

    const scene = compileDomModule(SRC)
    for (const t of scene.templates)
      // eslint-disable-next-line no-eval
      registerSkeleton(t.id, eval(`(${t.createCode})`))

    const received: unknown[][] = []
    setOpsExecutor(ops => received.push([...ops]))

    const file = fileURLToPath(new URL('../tmp-route-pending.mjs', import.meta.url))
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

    // switch route while the first fetch is still pending (gate shut)
    received.length = 0
    ;(globalThis as { __setKind?: (v: string) => void }).__setKind?.('local')
    await flushPromises()

    const all = received.flat()
    const idx = all.indexOf('Local Timeline')
    expect(idx).toBeGreaterThanOrEqual(0)
  })
})
