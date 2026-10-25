import type { FakeEl, FakePapiHost } from '../helpers/fake-papi'
/**
 * MT-IFR S1 lock: the direct sink and the frame path must be the same
 * renderer with a different destination.
 *
 * The Main Thread's IFR first screen applies every effect as the renderer
 * produces it (`main-thread/direct-sink.ts`) instead of recording a stream and
 * walking it afterwards (`ops-apply.ts`). Both share the appliers, so this
 * test pins the two things a divergence would break:
 *
 *   1. the recorded ops stream — the IFR reconcile (`ifr.ts`) compares the MT
 *      stream against the Background's byte for byte, and the direct sink
 *      still feeds it;
 *   2. the PAPI call sequence — same calls, same arguments, same order, so the
 *      first screen is the same pixels.
 *
 * The scene deliberately covers every op kind a first screen can produce:
 * INSTANTIATE (static skeleton), CREATE_TEXT, INSERT, SET_PROP (dynamic text
 * and attribute), SET_CLASS, SET_STYLE, SET_EVENT, plus For/Show dynamics.
 */
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'
import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetLynxTemplateState } from '../../packages/runtime/src/background/lynx-template'
import { resetMainThreadRefState } from '../../packages/runtime/src/background/main-thread-ref'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { resetOpsSink, setOpsSink } from '../../packages/runtime/src/background/ops-sink'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { directSink, resetDirectSink } from '../../packages/runtime/src/main-thread/direct-sink'
import { flushListUpdates } from '../../packages/runtime/src/main-thread/list-apply'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { registerSkeleton } from '../../packages/runtime/src/main-thread/skeleton-registry'
import { flushPromises } from '../helpers/async'
import { installFakePapi } from '../helpers/fake-papi'
import '../../packages/runtime/src/main-thread/index'

// Mock the `lynx` global (injected by the AMD wrapper on real devices)
;

(globalThis as { lynx: unknown }).lynx = {
  getCoreContext: () => ({
    addEventListener: () => {},
    dispatchEvent: () => {},
  }),
}

const g = globalThis as Record<string, unknown>

const SRC = `
import { render } from '@lynx-solid/runtime'
import { For, Show, createSignal } from 'solid-js'
const [count, setCount] = createSignal(2)
function Row(props: { it: { id: number, label: string } }) {
  return (
    <view class="row" style={{ width: '50px' }}>
      <text class={props.it.id % 2 ? 'odd' : 'even'}>{props.it.label}</text>
      <text bindtap={() => setCount(1)}>touch {props.it.id}</text>
    </view>
  )
}
function App() {
  return (
    <view class="app">
      <text>static head</text>
      <text>count: {count()}</text>
      <For each={[{ id: 1, label: 'a' }, { id: 2, label: 'b' }]}>{(it) => <Row it={it} />}</For>
      <Show when={count() > 1} fallback={<text>small</text>}>
        <text>big</text>
      </Show>
    </view>
  )
}
render(() => <App />)
`

interface Scene {
  code: string
  templates: ReturnType<typeof compileDomModule>['templates']
}

let scene: Scene
let counter = 0

beforeAll(() => {
  scene = compileDomModule(SRC)
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
  resetOpsSink()
}

/**
 * Record every engine call. Element arguments collapse to `type#uid` so two
 * runs are comparable without sharing element objects; arrays of elements
 * (__SetCSSId) collapse the same way.
 */
function recordPapi(host: FakePapiHost): unknown[][] {
  const calls: unknown[][] = []
  const isEl = (v: unknown): v is FakeEl =>
    typeof v === 'object' && v !== null && 'uid' in v && 'children' in v
  const norm = (v: unknown): unknown => {
    if (isEl(v))
      return `${v.type}#${v.uid}`
    if (Array.isArray(v))
      return v.map(norm)
    return v
  }
  for (const key of Object.keys(globalThis)) {
    if (!key.startsWith('__') || typeof g[key] !== 'function')
      continue
    const fn = g[key] as (...a: unknown[]) => unknown
    g[key] = (...args: unknown[]): unknown => {
      calls.push([key, ...args.map(norm)])
      return fn(...args)
    }
  }
  void host
  return calls
}

interface Run {
  host: FakePapiHost
  ops: unknown[]
  calls: unknown[][]
}

/**
 * One first screen. `frames` is today's path (render → captured stream →
 * applyOps); `direct` installs the direct sink so the effects happen during
 * the render, then runs only the tail applyOps would have run.
 */
async function runFirstScreen(mode: 'frames' | 'direct'): Promise<Run> {
  resetAll()
  const host = installFakePapi()
  const calls = recordPapi(host)
  ;(g.renderPage as () => void)()
  for (const t of scene.templates) {
    // eslint-disable-next-line no-eval
    registerSkeleton(t.id, eval(`(${t.createCode})`))
  }

  const received: unknown[][] = []
  setOpsExecutor(ops => received.push(ops))
  if (mode === 'direct') {
    resetDirectSink()
    setOpsSink(directSink)
  }

  const file = fileURLToPath(new URL(`../tmp-sink-${counter++}.mjs`, import.meta.url))
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

  if (mode === 'direct') {
    // The appliers already ran; only applyOps' tail is left (see the direct
    // branch in ifr-runtime.runIfrMount).
    flushListUpdates()
    ;(g.__FlushElementTree as () => void)()
    resetOpsSink()
  }
  else {
    for (const batch of received)
      applyOps(batch)
  }

  return { host, ops: received.flat(), calls }
}

describe('direct ops sink ≡ frame path (MT-IFR S1)', () => {
  it('produces the same ops stream and the same PAPI calls', async () => {
    const frames = await runFirstScreen('frames')
    const direct = await runFirstScreen('direct')

    // 1) the reconcile contract: byte-identical streams
    expect(direct.ops.length).toBeGreaterThan(0)
    expect(direct.ops).toEqual(frames.ops)

    // 2) the effect contract: same calls, same arguments, same order
    expect(direct.calls).toEqual(frames.calls)

    // sanity: the scene really exercises the first-screen op surface — a
    // degenerate scene would make the two comparisons above vacuous.
    const names = new Set(frames.calls.map(c => c[0]))
    for (const name of [
      '__CreateView',
      '__CreateText',
      '__AppendElement',
      '__SetAttribute',
      '__SetClasses',
      '__SetInlineStyles',
      '__AddEvent',
    ]) {
      expect(names, `${name} missing from the first screen`).toContain(name)
    }
    expect(frames.ops.length).toBeGreaterThan(50)

    // 3) and the resulting tree (guards against both runs being equally wrong)
    expect(direct.host.elements.map(e => `${e.type}#${e.uid}`))
      .toEqual(frames.host.elements.map(e => `${e.type}#${e.uid}`))
  })

  it('leaves no state behind: a second mount and the frame path still match', async () => {
    // 1) a later frame-path mount is unaffected by an earlier direct mount
    await runFirstScreen('direct')
    const framesAfter = await runFirstScreen('frames')
    const framesRef = await runFirstScreen('frames')
    expect(framesAfter.ops).toEqual(framesRef.ops)
    expect(framesAfter.calls).toEqual(framesRef.calls)

    // 2) a second direct mount is unaffected by the first (the `fresh` window
    //    is per mount, so ids from the previous pass must not count as fresh)
    const directOne = await runFirstScreen('direct')
    const directTwo = await runFirstScreen('direct')
    expect(directTwo.ops).toEqual(directOne.ops)
    expect(directTwo.calls).toEqual(directOne.calls)
  })
})
