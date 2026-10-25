/**
 * Repro: elk white-screen — the first frame must carry INSERT-to-page.
 * Compiled via the real fork pipeline (wrapConditionals + async-to-promises),
 * then executed; asserts the page-root insert survives the compiled shape of
 * Switch/Match + Loading + pending async memo.
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
import { Loading, Match, Switch, createMemo } from 'solid-js'

let __release
const gate = new Promise<string[]>(r => { __release = r })
;(globalThis as any).__release = __release

function TimelineFeed(props: { data: () => string[] }) {
  return <text class="feed">{props.data().join(',')}</text>
}

function TimelinePage() {
  const timeline = createMemo(async () => {
    return await gate
  })
  return (
    <view class="page">
      <text class="header">Local Timeline</text>
      <Loading fallback={<text class="spinner">loading…</text>}>
        <TimelineFeed data={timeline} />
      </Loading>
    </view>
  )
}

function App() {
  return (
    <view class="app-root">
      <Switch fallback={<text>404</text>}>
        <Match when={true}>
          <TimelinePage />
        </Match>
      </Switch>
    </view>
  )
}
render(() => <App />)
`

describe('compiled elk shape: first frame carries INSERT-to-page', () => {
  it('mounts spinner/header to page while async memo is pending', async () => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
    resetLynxTemplateState()
    resetMainThreadRefState()
    resetApplyOpsState()

    const scene = compileDomModule(SRC)
    installFakePapi()
    resetApplyOpsState()
    g.renderPage?.()
    for (const t of scene.templates)
      // eslint-disable-next-line no-eval
      registerSkeleton(t.id, eval(`(${t.createCode})`))

    const received: unknown[][] = []
    setOpsExecutor(ops => received.push([...ops]))

    const file = fileURLToPath(new URL('../tmp-elk-shape.mjs', import.meta.url))
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

    // decode: does any batch carry INSERT parent=1?
    const AR: Record<number, number> = { 1: 2, 2: 1, 3: 3, 4: 2, 5: 3, 6: 2, 7: 4, 8: 3, 9: 2, 10: 2, 11: 2, 14: 3 }
    const inserts: string[] = []
    for (const batch of received) {
      let i = 0
      while (i < batch.length) {
        const c = batch[i++] as number
        const a = AR[c]
        if (a === undefined)
          break
        const args = batch.slice(i, i + a)
        i += a
        if (c === 3)
          inserts.push(`INSERT p=${args[0]} c=${args[1]} a=${args[2]}`)
      }
    }
    for (const batch of received)
      applyOps(batch)

    expect(inserts.some(f => f.startsWith('INSERT p=1 '))).toBe(true)

    // settle: release the gate — content should replace the spinner
    ;(globalThis as { __release?: (v: string[]) => void }).__release?.(['post-a'])
    await flushPromises()
  })
})
