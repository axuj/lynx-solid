/**
 * End-to-end for the fork dom pipeline: compile a scene
 * through compileDomModule, execute the BG module against lynx-template
 * runtime (ops capture), apply the frames on the MT (createCode skeletons +
 * fake engine) and assert the final tree plus reactive updates.
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
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { iterOps, OP } from '../../packages/runtime/src/internal/ops'
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

const g = globalThis

const STATIC_DYN_SRC = `
import { render } from '@lynx-solid/runtime'
import { createSignal } from 'solid-js'
const [x, setX] = createSignal(0)
;(globalThis as any).__lynxSetX = setX
function App() {
  return (
    <view class="app">
      <text>hello</text>
      <text class={x() ? 'a' : 'b'}>{x()}</text>
      <text>tail</text>
    </view>
  )
}
render(() => <App />)
`

const SHOW_SRC = `
import { render } from '@lynx-solid/runtime'
import { Show, createSignal } from 'solid-js'
const [on, setOn] = createSignal(true)
;(globalThis as any).__lynxSetOn = setOn
function App() {
  return (
    <view>
      <text>static</text>
      <Show when={on()}><text>shown</text></Show>
      <text>tail</text>
    </view>
  )
}
render(() => <App />)
`

const TWOSHOWS_SRC = `
import { render } from '@lynx-solid/runtime'
import { Show, createSignal } from 'solid-js'
const [a, setA] = createSignal(true)
const [b, setB] = createSignal(true)
;(globalThis as any).__lynxSetA = setA
;(globalThis as any).__lynxSetB = setB
function App() {
  return (
    <view>
      <text>head</text>
      <Show when={a()}><text>A</text></Show>
      <Show when={b()}><text>B</text></Show>
    </view>
  )
}
render(() => <App />)
`

const LISTSHOW_SRC = `
import { render } from '@lynx-solid/runtime'
import { Show, createSignal } from 'solid-js'
const [a, setA] = createSignal(true)
const [b, setB] = createSignal(true)
;(globalThis as any).__lynxSetListA = setA
;(globalThis as any).__lynxSetListB = setB
function App() {
  return (
    <list>
      <list-item item-key="head"><text>head</text></list-item>
      <Show when={a()}><list-item item-key="A"><text>A</text></list-item></Show>
      <Show when={b()}><list-item item-key="B"><text>B</text></list-item></Show>
    </list>
  )
}
render(() => <App />)
`

const FOR_SRC = `
import { render } from '@lynx-solid/runtime'
import { For, createSignal } from 'solid-js'
const [items, setItems] = createSignal([{ id: 1, label: 'a' }, { id: 2, label: 'b' }])
;(globalThis as any).__lynxSetItems = setItems
function App() {
  return (
    <view>
      <For each={items()}>{(item) => <text>{item.label}</text>}</For>
    </view>
  )
}
render(() => <App />)
`

const APP_SRC = `
import { render } from '@lynx-solid/runtime'
import { createSignal, Show } from 'solid-js'
function App() {
  const [count, setCount] = createSignal(0)
  return (
    <view class="card">
      <text>count: {count()}</text>
      <Show when={count() > 0}>
        <text>positive</text>
      </Show>
      <view class="btn" bindtap={() => setCount(count() + 1)}>
        <text>+1</text>
      </view>
    </view>
  )
}
render(() => <App />)
`

const APP_BINDTAP_SRC = `
import { render } from '@lynx-solid/runtime'
import { createSignal, Show } from 'solid-js'
function App() {
  const [count, setCount] = createSignal(0)
  const handleTap = () => setCount(count() + 1)
  return (
    <view class="card">
      <text>count: {count()}</text>
      <Show when={count() > 0}>
        <text>positive</text>
      </Show>
      <view class="btn" bindtap={handleTap}>
        <text>+1</text>
      </view>
    </view>
  )
}
render(() => <App />)
`

const WORKLET_SRC = `
import { render, useMainThreadRef } from '@lynx-solid/runtime'
import { createSignal } from 'solid-js'
const [pos, setPos] = createSignal(0)
function App() {
  const mtRef = useMainThreadRef(null)
  const onScroll = (event: any) => {
    'main thread'
    const y = event.detail.scrollTop
    mtRef.current?.setStyleProperty('transform', 'translate(0px, ' + y + 'px)')
  }
  return (
    <view main-thread:bindscroll={onScroll} main-thread:ref={mtRef}>
      <text>worklet</text>
    </view>
  )
}
render(() => <App />)
`

interface Scene {
  code: string
  templates: ReturnType<typeof compileDomModule>['templates']
}

const scenes: Record<string, Scene> = {}
let counter = 0

beforeAll(() => {
  for (const [name, src] of Object.entries({ staticDyn: STATIC_DYN_SRC, show: SHOW_SRC, twoShows: TWOSHOWS_SRC, listShow: LISTSHOW_SRC, for: FOR_SRC, app: APP_SRC, appBindtap: APP_BINDTAP_SRC, worklet: WORKLET_SRC })) {
    scenes[name] = compileDomModule(src)
  }
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
  ;(g.__lynxSetX as (() => void) | undefined)?.()
  ;(g.__lynxSetOn as (() => void) | undefined)?.()
  ;(g.__lynxSetItems as (() => void) | undefined)?.()
  ;(g.__lynxSetA as (() => void) | undefined)?.()
  ;(g.__lynxSetB as (() => void) | undefined)?.()
  ;(g.__lynxSetListA as (() => void) | undefined)?.()
  ;(g.__lynxSetListB as (() => void) | undefined)?.()
  delete g.__lynxSetX
  delete g.__lynxSetOn
  delete g.__lynxSetItems
  delete g.__lynxSetA
  delete g.__lynxSetB
  delete g.__lynxSetListA
  delete g.__lynxSetListB
}

/** Write the BG module to a temp file, import it, capture ops. */
async function runBgModule(scene: Scene): Promise<unknown[][]> {
  const received: unknown[][] = []
  setOpsExecutor(ops => received.push(ops))
  const file = fileURLToPath(new URL(`../tmp-lynx-${counter++}.mjs`, import.meta.url))
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

/** Register the compiled createCode literals as MT skeletons. */
function installSkeletons(scene: Scene): void {
  for (const t of scene.templates) {
    // eslint-disable-next-line no-eval
    registerSkeleton(t.id, eval(`(${t.createCode})`))
  }
}

function bootHost(): ReturnType<typeof installFakePapi> {
  const host = installFakePapi()
  resetApplyOpsState()
  g.renderPage?.()
  return host
}

describe('lynx template e2e (fork dom pipeline)', () => {
  it('instantiates static skeleton on the MT, dynamic bindings by refs ids', async () => {
    resetAll()
    const scene = scenes.staticDyn!
    const host = bootHost()
    installSkeletons(scene)
    const received = await runBgModule(scene)

    // BG: single INSTANTIATE with empty diffs and a firstId run.
    const flat = received.flat()
    const instIdx = flat.indexOf(OP.INSTANTIATE)
    expect(instIdx).toBeGreaterThanOrEqual(0)
    const [, tplId, diffs, firstId] = flat.slice(instIdx, instIdx + 4)
    // content-hash id — must match the compiled metadata
    expect(tplId).toBe(scenes.staticDyn!.templates[0]!.id)
    expect(diffs).toEqual([])
    expect(firstId).toBe(2)

    for (const batch of received)
      applyOps(batch)

    const view = host.root.children[0]!
    expect(view.type).toBe('view')
    expect(view.attrs.class).toBe('app')
    expect(view.children).toHaveLength(3)
    // single static text children fold into the text attribute on the element
    expect(view.children[0]!.attrs.text).toBe('hello')
    expect(view.children[2]!.attrs.text).toBe('tail')
    // dynamic text element: refs[1] → firstId + offset 2 (folded siblings)
    const dyn = view.children[1]!
    expect(dyn.attrs.class).toBe('b')
    // the value rides the element's `text` attribute — the same channel as a
    // hand-written `<text text={…}>`, which does not stringify the value either
    expect(String(dyn.attrs.text)).toBe('0')

    // update: signal → SET_PROP (the element's text attribute) + SET_CLASS
    received.length = 0
    ;(g.__lynxSetX as (v: number) => void)(5)
    await flushPromises()
    const updateOps = received.flat()
    expect(updateOps).toContain(OP.SET_PROP)
    expect(updateOps).toContain(OP.SET_CLASS)
    for (const batch of received)
      applyOps(batch)
    expect(String(dyn.attrs.text)).toBe('5')
    expect(dyn.attrs.class).toBe('a')
  })

  it('ships first-frame dynamics in the same batch as INSTANTIATE (no hole values needed)', async () => {
    // Batch-atomicity invariant: the initial dynamic bindings travel with
    // the INSTANTIATE frame, so the first frame is complete without passing
    // hole values at instantiation (cf. element-template `__hN` props).
    // If this ever splits across batches, revisit hole-value passing.
    resetAll()
    const scene = scenes.staticDyn!
    bootHost()
    installSkeletons(scene)
    const received = await runBgModule(scene)
    const withInstantiate = received.filter(batch =>
      (batch as unknown[]).includes(OP.INSTANTIATE),
    )
    expect(withInstantiate.length).toBeGreaterThan(0)
    for (const batch of withInstantiate) {
      const flat = batch as unknown[]
      expect(flat).toContain(OP.SET_PROP)
      expect(flat).toContain(OP.SET_CLASS)
    }
  })

  it('toggles Show subtrees between static siblings (marker anchor)', async () => {
    resetAll()
    const scene = scenes.show!
    const host = bootHost()
    // Same strictness as the twoShows test: re-insert anchors must resolve
    // to real children of the view.
    host.strictAnchors = true
    installSkeletons(scene)
    const received = await runBgModule(scene)

    for (const batch of received)
      applyOps(batch)

    const view = host.root.children[0]!
    expect(view.children.map(c => c.attrs.text)).toEqual(['static', 'shown', 'tail'])

    // off → the Show subtree is removed, siblings stay, and the slot leaves
    // zero MT nodes (empty text stays a pure BG anchor).
    received.length = 0
    ;(g.__lynxSetOn as (v: boolean) => void)(false)
    await flushPromises()
    const offOps = received.flat()
    expect(offOps).toContain(OP.REMOVE)
    for (const batch of received)
      applyOps(batch)
    expect(view.children.map(c => c.attrs.text)).toEqual(['static', 'tail'])

    // on again → re-inserted before the tail marker
    received.length = 0
    ;(g.__lynxSetOn as (v: boolean) => void)(true)
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(view.children.map(c => c.attrs.text)).toEqual(['static', 'shown', 'tail'])
  })

  it('orders trailing Show subtrees through BG-only markers (no MT placeholders)', async () => {
    resetAll()
    const scene = scenes.twoShows!
    const host = bootHost()
    // Every marker-resolved anchor in this view tree must be a real child —
    // strict mode fails the test if BG ever emits a stale/foreign anchor.
    host.strictAnchors = true
    installSkeletons(scene)
    const received = await runBgModule(scene)

    for (const batch of received)
      applyOps(batch)

    // mount: head + A + B, every child a text element — the two trailing
    // slots anchor on BG-only markers, so the MT builds zero placeholder
    // views (only the root view is ever created)
    const view = host.root.children[0]!
    const texts = (): (unknown)[] => view.children.map(c => c.attrs.text)
    expect(view.children.map(c => c.type)).toEqual(['text', 'text', 'text'])
    expect(texts()).toEqual(['head', 'A', 'B'])
    expect(host.createCalls.filter(c => c.tag === 'view')).toHaveLength(1)

    // a off → the slot vanishes from the MT entirely (empty text stays a
    // pure BG anchor now): head + B, zero placeholder nodes of any kind
    received.length = 0
    ;(g.__lynxSetA as (v: boolean) => void)(false)
    await flushPromises()
    // Walk frames, not `.flat()` — a flat scan cannot tell an opcode from
    // an id argument, so `not.toContain(CREATE_TEXT)` was really "no element
    // happens to be id 2" and silently depended on id numbering.
    const offCodes = received.flatMap(batch => [...iterOps(batch)].map(op => op[0]))
    expect(offCodes).toContain(OP.REMOVE)
    expect(offCodes).not.toContain(OP.CREATE_TEXT)
    for (const batch of received)
      applyOps(batch)
    expect(view.children.map(c => c.type)).toEqual(['text', 'text'])
    expect(texts()).toEqual(['head', 'B'])

    // a on again → re-inserted BEFORE B (marker resolve, not tail append)
    received.length = 0
    ;(g.__lynxSetA as (v: boolean) => void)(true)
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(texts()).toEqual(['head', 'A', 'B'])

    // b off/on cycles symmetrically (off leaves zero MT nodes behind)
    received.length = 0
    ;(g.__lynxSetB as (v: boolean) => void)(false)
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(texts()).toEqual(['head', 'A'])
    received.length = 0
    ;(g.__lynxSetB as (v: boolean) => void)(true)
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(texts()).toEqual(['head', 'A', 'B'])
    expect(host.createCalls.filter(c => c.tag === 'view')).toHaveLength(1)
  })

  it('toggles Show rows under list through BG-only markers (ordered update-list-info)', async () => {
    resetAll()
    const scene = scenes.listShow!
    const host = bootHost()
    installSkeletons(scene)
    const received = await runBgModule(scene)

    for (const batch of received)
      applyOps(batch)

    // mount: A + B as datasource actions in order (both trailing Show
    // slots anchor on BG-only markers — no placeholder view ever enters the
    // native list, and static item-keys ride the platform-info maps).
    // NOTE: the static head row bypasses the datasource (skeleton P.append
    // mounts it straight into the native tree; only INSERT ops feed
    // insertListItem) — positions below are datasource indices, which is
    // also why the single-For discipline keeps every row dynamic.
    const list = host.root.children[0]!
    expect(list.type).toBe('list')
    const info = (): { insertAction: unknown[], removeAction: unknown[] } =>
      list.attrs['update-list-info'] as { insertAction: unknown[], removeAction: unknown[] }
    expect(info().insertAction).toMatchObject([
      { 'position': 0, 'item-key': 'A' },
      { 'position': 1, 'item-key': 'B' },
    ])

    // a off → row 0 removed
    received.length = 0
    ;(g.__lynxSetListA as (v: boolean) => void)(false)
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(info().removeAction).toEqual([0])

    // a on again → re-inserted at datasource position 0, i.e. BEFORE B
    // (marker resolve, not tail append)
    received.length = 0
    ;(g.__lynxSetListA as (v: boolean) => void)(true)
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(info().insertAction).toMatchObject([
      { 'position': 0, 'item-key': 'A' },
    ])

    // b off/on cycles symmetrically (trailing marker appends at the tail)
    received.length = 0
    ;(g.__lynxSetListB as (v: boolean) => void)(false)
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(info().removeAction).toEqual([1])
    received.length = 0
    ;(g.__lynxSetListB as (v: boolean) => void)(true)
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(info().insertAction).toMatchObject([
      { 'position': 1, 'item-key': 'B' },
    ])
  })

  it('renders For rows through the template children path', async () => {
    resetAll()
    const scene = scenes.for!
    const host = bootHost()
    installSkeletons(scene)
    const received = await runBgModule(scene)

    for (const batch of received)
      applyOps(batch)

    const view = host.root.children[0]!
    expect(view.children.map(c => c.attrs.text)).toEqual(['a', 'b'])

    received.length = 0
    ;(g.__lynxSetItems as (v: unknown[]) => void)([{ id: 1, label: 'a' }, { id: 3, label: 'c' }])
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(view.children.map(c => c.attrs.text)).toEqual(['a', 'c'])
  })

  it('full app scene: dynamic text, Show toggle and bindtap event (unique refs slots)', async () => {
    resetAll()
    const scene = scenes.app!
    const host = bootHost()
    installSkeletons(scene)
    const received = await runBgModule(scene)

    for (const batch of received)
      applyOps(batch)

    const card = host.root.children[0]!
    expect(card.attrs.class).toBe('card')
    // children: text(count:0), btn(+1) — the off Show leaves zero MT nodes
    // (its marker and empty text stay pure BG anchors).
    expect(card.children).toHaveLength(2)
    expect(card.children[0]!.children.map(c => c.attrs.text)).toEqual(['count: ', '0'])
    const btn = card.children[1]!
    expect(btn.attrs.class).toBe('btn')

    // bindtap was registered as an event (not SET_PROP).
    const tap = btn.events.find(e => e.eventName === 'tap')
    expect(tap).toBeDefined()
    expect(tap!.sign).toBeDefined()

    // tap → count 1 → dynamic text updates and Show subtree appears
    // (re-inserted before the btn marker anchor).
    received.length = 0
    const { publishEvent } = await import('../../packages/runtime/src/background/event-registry')
    publishEvent(tap!.sign!, {})
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(card.children[0]!.children.map(c => c.attrs.text)).toEqual(['count: ', '1'])
    expect(card.children).toHaveLength(3)
    expect(card.children[1]!.attrs.text).toBe('positive')
    expect(card.children[2]!.children[0]!.attrs.text).toBe('+1')

    // tap again → count 2, Show stays.
    received.length = 0
    publishEvent(tap!.sign!, {})
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(card.children[0]!.children.map(c => c.attrs.text)).toEqual(['count: ', '2'])
    expect(card.children).toHaveLength(3)
  })

  it('bindtap compiles to the plain attribute path and registers the engine "tap" event', async () => {
    resetAll()
    const scene = scenes.appBindtap!
    const host = bootHost()
    installSkeletons(scene)
    const received = await runBgModule(scene)

    for (const batch of received)
      applyOps(batch)

    const card = host.root.children[0]!
    // off-state Show leaves zero MT nodes: text + btn only.
    expect(card.children).toHaveLength(2)
    const btn = card.children[1]!
    expect(btn.attrs.class).toBe('btn')

    // bindtap → lynx engine event "tap", not a $$ prop.
    const tap = btn.events.find(e => e.eventName === 'tap')
    expect(tap).toBeDefined()

    received.length = 0
    const { publishEvent } = await import('../../packages/runtime/src/background/event-registry')
    publishEvent(tap!.sign!, {})
    await flushPromises()
    for (const batch of received)
      applyOps(batch)
    expect(card.children[0]!.children.map(c => c.attrs.text)).toEqual(['count: ', '1'])
    expect(card.children).toHaveLength(3)
  })

  it('routes main-thread:bind* + \'main thread\' directive handlers as MT worklets, not BG events', async () => {
    resetAll()
    const scene = scenes.worklet!
    const host = bootHost()
    installSkeletons(scene)
    const received = await runBgModule(scene)
    const flat = received.flat()

    // worklet binding: MT_SET_EVENT with a worklet context — no SET_EVENT.
    const mtIdx = flat.indexOf(OP.MT_SET_EVENT)
    expect(mtIdx).toBeGreaterThanOrEqual(0)
    const [, id, eventType, eventName, payload] = flat.slice(mtIdx, mtIdx + 5) as [unknown, number, string, string, unknown]
    expect(eventType).toBe('bindEvent')
    expect(eventName).toBe('scroll')
    const ctx = payload as { _wkltId: string, _c: { mtRef: { _wvid: number } } }
    expect(ctx._wkltId).toMatch(/^[0-9a-f]+:[0-9a-f]+:\d+$/)
    expect(ctx._c.mtRef._wvid).toEqual(expect.any(Number))
    expect(flat).not.toContain(OP.SET_EVENT)

    // the handler's captured ref is bound to the same element via SET_MT_REF.
    const refIdx = flat.indexOf(OP.SET_MT_REF)
    expect(refIdx).toBeGreaterThanOrEqual(0)
    expect(flat[refIdx + 1]).toBe(id)
    expect(flat[refIdx + 2]).toBe(ctx._c.mtRef._wvid)

    for (const batch of received)
      applyOps(batch)

    const view = host.root.children[0]!
    expect(view.children[0]!.attrs.text).toBe('worklet')
    // MT worklet slot on the element — native routing, no BG sign.
    const evt = view.events.find(e => e.eventName === 'scroll')
    expect(evt).toBeDefined()
    expect(evt!.sign).toEqual({ type: 'worklet', value: payload })
  })
})
