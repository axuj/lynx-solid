/**
 * Object-valued `style` / `class` bindings from a store (solidjs/solid#3326).
 *
 * `style()` / `className()` enumerate their object in the effect's untracked
 * commit phase, so a store sub-object was identity-reactive only: mutating
 * `state.s.color` in place never re-ran the effect. The compiler now wraps
 * those computed values in `readShallow()`, which copies one layer with
 * tracked reads. This test compiles a real component, runs the BG module
 * against the fake PAPI + MT ops applier, mutates the store draft and asserts
 * exactly one MT update lands.
 */

import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRoot, createStore } from 'solid-js'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'
import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import {
  readShallow,
  resetLynxTemplateState,
} from '../../packages/runtime/src/background/lynx-template'
import { resetMainThreadRefState } from '../../packages/runtime/src/background/main-thread-ref'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { iterOps, OP } from '../../packages/runtime/src/internal/ops'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { registerSkeleton } from '../../packages/runtime/src/main-thread/skeleton-registry'
import { flushPromises } from '../helpers/async'
import { installFakePapi } from '../helpers/fake-papi'
import '../../packages/runtime/src/main-thread/index'

const g = globalThis as {
  lynx: unknown
  __lynxUpdateStore?: () => void
}

g.lynx = {
  getCoreContext: () => ({
    addEventListener: () => {},
    dispatchEvent: () => {},
  }),
}

const STORE_SRC = `
import { render } from '@lynx-solid/runtime'
import { createStore } from 'solid-js'
const [state, setState] = createStore({
  s: { color: 'red', fontSize: '12px' },
  cls: { on: true },
})
;(globalThis as any).__lynxUpdateStore = () => setState((s) => {
  s.s.color = 'blue'
  s.cls.on = false
})
function App() {
  return (
    <view style={state.s} class={state.cls}>
      <text>store</text>
    </view>
  )
}
render(() => <App />)
`

let scene: ReturnType<typeof compileDomModule>
let counter = 0

beforeAll(() => {
  scene = compileDomModule(STORE_SRC)
})

function resetAll(): void {
  resetOpsBuffer()
  resetFlushState()
  resetShadowState()
  resetRegistry()
  resetNodeOpsState()
  resetLynxTemplateState()
  resetMainThreadRefState()
  resetApplyOpsState()
  delete g.__lynxUpdateStore
}

async function runBgModule(): Promise<unknown[][]> {
  const received: unknown[][] = []
  setOpsExecutor(ops => received.push(ops))
  const file = fileURLToPath(new URL(`../tmp-style-store-${counter++}.mjs`, import.meta.url))
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
  return received
}

describe('store sub-object style / class (readShallow)', () => {
  beforeEach(() => {
    resetAll()
  })

  it('re-applies in-place style/class mutations exactly once', async () => {
    const host = installFakePapi()
    globalThis.renderPage?.()
    for (const t of scene.templates) {
      // eslint-disable-next-line no-eval
      registerSkeleton(t.id, eval(`(${t.createCode})`))
    }

    const received = await runBgModule()
    for (const batch of received)
      applyOps(batch)

    const view = host.root.children[0]!
    expect(view.style.color).toBe('red')
    expect(view.style['font-size']).toBe('12px')
    expect(view.attrs.class).toBe('on')

    received.length = 0
    g.__lynxUpdateStore!()
    await flushPromises()

    // one coalesced batch: SET_STYLE + SET_CLASS for the same element
    expect(received).toHaveLength(1)
    const ops = [...iterOps(received[0]!)]
    expect(ops.filter(([code]) => code === OP.SET_STYLE)).toHaveLength(1)
    expect(ops.filter(([code]) => code === OP.SET_CLASS)).toHaveLength(1)

    applyOps(received[0]!)
    expect(view.style.color).toBe('blue')
    expect(view.style['font-size']).toBe('12px')
    expect(view.attrs.class).toBe('')
  })

  it('readShallow: strings/plain objects pass through, proxies and proxy arrays are copied', () => {
    expect(readShallow('color: red')).toBe('color: red')
    expect(readShallow(42)).toBe(42)
    expect(readShallow(null)).toBe(null)

    const plain = { color: 'red' }
    expect(readShallow(plain)).toBe(plain)

    createRoot(() => {
      const [state] = createStore({
        s: { color: 'red' },
        cls: { on: true },
        list: [{ a: true }],
      })
      expect(readShallow(state.s)).toEqual({ color: 'red' })
      expect(readShallow(state.s)).not.toBe(state.s)
      // arrays of plain literals keep identity; array with a proxy element is remapped
      const literal = [{ a: true }]
      expect(readShallow(literal)).toBe(literal)
      const mapped = readShallow(state.list) as unknown[]
      expect(mapped).not.toBe(state.list)
      expect(mapped[0]).not.toBe(state.list[0])
      expect(mapped[0]).toEqual({ a: true })
    })
  })
})
