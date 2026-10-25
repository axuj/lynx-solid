/**
 * Regression lock for the id-allocation invariant MT-IFR rests on.
 *
 * The Main Thread's IFR first screen renders with Solid's server build (one
 * synchronous pass, no reactive graph) and compares its ops against the
 * Background Thread's client-build render. That comparison is only cheap when
 * the two streams are IDENTICAL — otherwise every first screen tears down and
 * repaints, which is worse than not doing IFR at all.
 *
 * They are not identical by construction. Solid's server and client builds
 * insert the same NUMBER of placeholder text nodes but at DIFFERENT positions,
 * so any id burned by an invisible node shifts every later id and the streams
 * diverge. `ShadowElement` therefore defers id assignment for empty `#text`
 * (see DEFERRED_ID in background/shadow-element.ts) so the counter tracks
 * only ids that actually reach the Main Thread.
 *
 * If this test fails, either the deferred allocation regressed or a Solid
 * upgrade changed how the two builds materialize placeholders. Both break
 * MT-IFR.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { compileDomModule } from '../../packages/compiler/src/dom-compile'
import { OP } from '../../packages/runtime/src/internal/ops'

const RUNTIME_SRC = resolve(__dirname, '../../packages/runtime/src')

/**
 * Exercises the constructs that allocate placeholder text nodes: Show/For
 * off-state slots and nested keyed lists are where the two builds disagree on
 * placeholder ORDER, so they must all be present for this test to mean
 * anything.
 */
const SRC = `
import { createSignal, Show, For, Switch, Match, createMemo, createContext, useContext } from 'solid-js'
import { createPageRoot, renderer } from '@lynx-solid/runtime/background/renderer'

const [user] = createSignal<any>({name:'ada'})
const [items] = createSignal<any[]>([{id:1,label:'A',tags:['x','y']},{id:2,label:'B',tags:[]}])
const [n] = createSignal(7)
const [route] = createSignal('home')
const [maybe] = createSignal<any>(null)

const Ctx = createContext({v:0})

function Row(props: {it: any, i: number}) {
  return (
    <view class="row">
      <text>{props.it.label}</text>
      <For each={props.it.tags}>{(t) => <text>#{t}</text>}</For>
      <Show when={props.it.tags.length > 0} fallback={<text>none</text>}>
        <text>has</text>
      </Show>
      <Switch fallback={<text>?</text>}>
        <Match when={props.i === 0}><text>first</text></Match>
        <Match when={props.i === 1}><text>second</text></Match>
      </Switch>
    </view>
  )
}

function App() {
  const c = useContext(Ctx)
  const double = createMemo(() => n() * 2)
  return (
    <view class="app" data-v={c.v}>
      <text>hello</text>
      <Show when={user()} fallback={<text>login</text>}>
        {(u) => <text>{u().name}</text>}
      </Show>
      <Show when={maybe()} fallback={<text>none</text>}>
        <text>maybe</text>
      </Show>
      <For each={items()}>{(it, i) => <Row it={it} i={i()} />}</For>
      <text>{double()}</text>
      <Switch fallback={<text>404</text>}>
        <Match when={route() === 'home'}><text>H</text></Match>
      </Switch>
    </view>
  )
}
renderer.render(() => (
  <Ctx value={{ v: 1 }}>
    <App />
  </Ctx>
), createPageRoot())
`

function loadWith(solidBuild: 'client' | 'server'): string {
  const { code } = compileDomModule(SRC)
  const file = solidBuild === 'client' ? 'solid.js' : 'server.js'
  const solidPath = resolve(__dirname, `../../node_modules/solid-js/dist/${file}`)
  const q = (p: string) => JSON.stringify(p)
  const rewritten = code
    .replace(
      /(['"])@lynx-solid\/runtime\/background\/renderer\1/g,
      q(join(RUNTIME_SRC, 'background/renderer.ts')),
    )
    .replace(/(['"])solid-js\1/g, q(solidPath))
    .replace(
      /(['"])@lynx-solid\/runtime\/lynx-template\1/g,
      q(join(RUNTIME_SRC, 'background/lynx-template.ts')),
    )

  const dir = mkdtempSync(join(tmpdir(), `ifr-id-align-${solidBuild}-`))
  const out = join(dir, 'mod.mjs')
  writeFileSync(out, rewritten)
  return pathToFileURL(out).href
}

async function renderAndCapture(url: string): Promise<unknown[]> {
  const shadow = await import(`${RUNTIME_SRC}/background/shadow-element.ts`)
  const buffer = await import(`${RUNTIME_SRC}/background/ops-buffer.ts`)
  const flush = await import(`${RUNTIME_SRC}/background/flush.ts`)
  const nodeOps = await import(`${RUNTIME_SRC}/background/node-ops.ts`)

  buffer.resetOpsBuffer()
  shadow.resetShadowState()
  nodeOps.resetNodeOpsState()
  flush.resetFlushState()
  const captured: unknown[] = []
  flush.setOpsExecutor((ops: unknown[]) => captured.push(...ops))

  await import(/* @vite-ignore */ url)
  await new Promise(r => setTimeout(r, 50))
  flush.setOpsExecutor(null as unknown as (ops: unknown[]) => void)
  return captured
}

/** First differing frame index, or -1 when the streams match. */
function firstDivergence(a: unknown[], b: unknown[]): number {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i]))
      return i
  }
  return -1
}

describe('id allocation: client-build and server-build renders must agree', () => {
  it('emits an identical ops stream from both Solid builds', async () => {
    const clientOps = await renderAndCapture(loadWith('client'))
    const serverOps = await renderAndCapture(loadWith('server'))

    // Sanity: the scene must actually have produced a tree, otherwise
    // "identical" is vacuously true.
    expect(clientOps.length).toBeGreaterThan(40)
    expect(serverOps).toHaveLength(clientOps.length)

    const at = firstDivergence(clientOps, serverOps)
    if (at !== -1) {
      const from = Math.max(0, at - 6)
      throw new Error(
        `server-build ops diverge from client-build ops at frame ${at}. `
        + `MT-IFR would tear down and repaint on every first screen.\n`
        + `  client[${from}..]: ${JSON.stringify(clientOps.slice(from, at + 6))}\n`
        + `  server[${from}..]: ${JSON.stringify(serverOps.slice(from, at + 6))}`,
      )
    }
  }, 60000)

  it('does not burn ids on empty text placeholders', async () => {
    const shadow = await import(`${RUNTIME_SRC}/background/shadow-element.ts`)
    const buffer = await import(`${RUNTIME_SRC}/background/ops-buffer.ts`)
    const flush = await import(`${RUNTIME_SRC}/background/flush.ts`)
    const nodeOps = await import(`${RUNTIME_SRC}/background/node-ops.ts`)

    buffer.resetOpsBuffer()
    shadow.resetShadowState()
    nodeOps.resetNodeOpsState()
    flush.resetFlushState()

    const empty = nodeOps.nodeOps.createTextNode('')
    expect(empty.isDeferred).toBe(true)
    // The whole point: the counter did not move.
    expect(shadow.ShadowElement.nextId).toBe(2)
    // An empty placeholder ships nothing to the Main Thread.
    expect(buffer.takeOps()).toEqual([])

    // First fill is where the node earns an id.
    nodeOps.nodeOps.replaceText(empty, 'hi')
    expect(empty.isDeferred).toBe(false)
    expect(empty.id).toBe(2)
    expect(shadow.ShadowElement.nextId).toBe(3)
    expect(buffer.takeOps()).toEqual([OP.CREATE_TEXT, 2, OP.SET_TEXT, 2, 'hi'])

    // A second empty placeholder still costs nothing.
    const empty2 = nodeOps.nodeOps.createTextNode('')
    expect(empty2.isDeferred).toBe(true)
    expect(shadow.ShadowElement.nextId).toBe(3)

    // Materializing is idempotent — re-filling must not re-allocate.
    nodeOps.nodeOps.replaceText(empty, 'bye')
    expect(empty.id).toBe(2)
    expect(shadow.ShadowElement.nextId).toBe(3)

    flush.setOpsExecutor(null as unknown as (ops: unknown[]) => void)
  })
})
