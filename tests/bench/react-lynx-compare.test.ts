/**
 * Same-machine comparison: ReactLynx vs lynx-solid on the octane
 * `lynx-render` krausest-style keyed table workload.
 *
 * Scenario (mirrors octane benchmarks/lynx-render/src/App.lynx.tsrx and its
 * ReactLynx twin react-workload.mjs): container/jumbotron/stats + N keyed
 * rows, each with an id cell, a tappable label cell (selects the row) and a
 * tappable remove cell (bumps a counter). 1k rows = 9,008 reachable hosts +
 * 2,000 event tokens; 10k = 90,008 + 20,000.
 *
 * Timing follows the octane contract: `performance.now()` around the mount
 * (or the first native tap after a settled mount) + settle (flush + 8
 * microtask turns), 9 samples, median. Both sides run in-process with a
 * deliberately cheap fake Element PAPI, so the numbers measure framework JS
 * (render + ops/snapshot generation + apply), not native element work.
 * ReactLynx numbers are produced by `node benchmarks/lynx-render/run.mjs 9`
 * in octane (pinned @lynx-js/react@0.123.0 production Snapshot backend,
 * real Snapshot patch serialization) on this machine, 2026-08-16.
 *
 * Caveats: ours includes module parse per sample (fresh temp module per
 * round, like the other bench files) and real ops JSON serialization;
 * ReactLynx side includes real Snapshot patch serialization too. Both sides
 * omit BG-thread boot and IPC.
 */

import type { OpCode } from '../../packages/runtime/src/internal/ops'
import type { FakeEl, FakePapiHost } from '../helpers/fake-papi'
import { rmSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'
import { publishEvent, resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetLynxTemplateState } from '../../packages/runtime/src/background/lynx-template'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { OP, OP_ARITY } from '../../packages/runtime/src/internal/ops'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { registerSkeleton } from '../../packages/runtime/src/main-thread/skeleton-registry'
import { flushPromises } from '../helpers/async'
import {

  installFakePapi,
} from '../helpers/fake-papi'

function resetAll(): void {
  resetOpsBuffer()
  resetFlushState()
  resetShadowState()
  resetRegistry()
  resetNodeOpsState()
  resetLynxTemplateState()
  resetApplyOpsState()
}

function appSrc(rows: number): string {
  return `import { render } from '@lynx-solid/runtime'
import { For, createSignal } from 'solid-js'
const rows = Array.from({ length: ${rows} }, (_, i) => ({ id: i + 1, label: 'row label ' + (i + 1) }))
function BenchApp() {
  const [selected, setSelected] = createSignal(0)
  const [removed, setRemoved] = createSignal(0)
  return (<view class="container">
    <view class="jumbotron">
      <text class="title">Octane Lynx</text>
      <text class="stats">{'selected=' + selected() + ' removed=' + removed()}</text>
    </view>
    <view class="table">
      <For each={rows}>{(row) => (<view class={row.id === selected() ? 'row danger' : 'row'} id={'row-' + row.id}>
        <text class="col-id">{String(row.id)}</text>
        <view class="col-label" bindtap={() => setSelected(row.id)}><text>{row.label}</text></view>
        <view class="col-remove" bindtap={() => setRemoved((c: number) => c + 1)}><text>x</text></view>
      </view>)}</For>
    </view>
  </view>)
}
render(() => <BenchApp />)`
}

function emptySrc(): string {
  return `import { render } from '@lynx-solid/runtime'
function EmptyApp() {
  return (<view class="container" />)
}
render(() => <EmptyApp />)`
}

let tmpCounter = 0

interface Mounted {
  host: FakePapiHost
  received: unknown[][]
  sign: string
}

/** Import the compiled BG module, settle, and apply ops — the timed segment. */
async function mount(code: string, templates: { id: number, createCode: string }[]): Promise<Mounted> {
  const host = installFakePapi()
  resetApplyOpsState()
  const createPage = (globalThis as Record<string, unknown>).__CreatePage as
    | ((componentId: string, cssId: number) => void)
    | undefined
  createPage?.('0', 0)
  for (const t of templates) {
    // eslint-disable-next-line no-eval
    registerSkeleton(t.id, eval(`(${t.createCode})`))
  }
  const received: unknown[][] = []
  setOpsExecutor(ops => received.push(ops))
  const file = fileURLToPath(new URL(`../tmp-krausest-${tmpCounter++}.mjs`, import.meta.url))
  writeFileSync(
    file,
    code
      .replaceAll('@lynx-solid/runtime/lynx-template', '../packages/runtime/src/background/lynx-template.ts')
      .replaceAll('@lynx-solid/runtime', '../packages/runtime/src/index.ts'),
  )
  try {
    await import(pathToFileURL(file).href)
  }
  finally {
    rmSync(file, { force: true })
  }
  const sign = firstEventSignFromOps(received)
  return { host, received, sign }
}

/** First tap handler sign in the emitted batches — SET_EVENT frames `[7, id, type, name, sign]`. */
function firstEventSignFromOps(received: unknown[][]): string {
  for (const batch of received) {
    let i = 0
    while (i < batch.length) {
      const code = batch[i] as number
      if (code === OP.SET_EVENT)
        return batch[i + 4] as string
      i += 1 + (OP_ARITY[code as OpCode] ?? 0)
    }
  }
  return ''
}

async function settle(received: unknown[][]): Promise<void> {
  await flushPromises()
  for (const batch of received.splice(0))
    applyOps(batch)
  for (let turn = 0; turn < 8; turn++)
    await Promise.resolve()
}

/** Trees hang off the skeleton roots (created via __CreateElement), not the page root. */
function treeRoots(host: FakePapiHost): FakeEl[] {
  return host.elements.filter(el => el.parent === null && el.uid !== 1)
}

function countNodes(el: FakeEl): number {
  let n = 1
  for (const c of el.children)
    n += countNodes(c)
  return n
}

function countEvents(el: FakeEl): number {
  let n = el.events.length
  for (const c of el.children)
    n += countEvents(c)
  return n
}

interface Scene {
  code: string
  templates: ReturnType<typeof compileDomModule>['templates']
  rows: number
}

const COMPILED: Record<string, ReturnType<typeof compileDomModule>> = {
  empty: compileDomModule(emptySrc()),
  rows1k: compileDomModule(appSrc(1000)),
  rows10k: compileDomModule(appSrc(10000)),
}

const SCENES: Record<string, Scene> = {
  empty: { code: COMPILED.empty!.code, templates: COMPILED.empty!.templates, rows: 0 },
  rows1k: { code: COMPILED.rows1k!.code, templates: COMPILED.rows1k!.templates, rows: 1000 },
  rows10k: { code: COMPILED.rows10k!.code, templates: COMPILED.rows10k!.templates, rows: 10000 },
}

/** 9-sample median of a timed op, mirroring octane's run.mjs. */
async function medianCreate(scene: Scene): Promise<{ ms: number, nodes: number, tokens: number }> {
  const samples: number[] = []
  let nodes = 0
  let tokens = 0
  for (let i = 0; i < 9; i++) {
    resetAll()
    const t0 = performance.now()
    const m = await mount(scene.code, scene.templates)
    await settle(m.received)
    samples.push(performance.now() - t0)
    nodes = treeRoots(m.host).reduce((sum, root) => sum + countNodes(root), 0)
    tokens = treeRoots(m.host).reduce((sum, root) => sum + countEvents(root), 0)
  }
  const sorted = samples.slice().sort((a, b) => a - b)
  return { ms: sorted[4]!, nodes, tokens }
}

async function medianUpdate(scene: Scene): Promise<number> {
  const samples: number[] = []
  for (let i = 0; i < 9; i++) {
    resetAll()
    const m = await mount(scene.code, scene.templates)
    await settle(m.received)
    if (m.sign === '') {
      throw new Error('update bench requires a mounted tap handler')
    }
    const t0 = performance.now()
    publishEvent(m.sign, {
      type: 'tap',
      timestamp: 1,
      target: { id: 'row-1', uid: 1, dataset: {} },
      currentTarget: { id: 'row-1', uid: 1, dataset: {} },
    })
    await settle(m.received)
    samples.push(performance.now() - t0)
  }
  const sorted = samples.slice().sort((a, b) => a - b)
  return sorted[4]!
}

/** ReactLynx baseline: `node benchmarks/lynx-render/run.mjs 9`, octane repo, this machine, 2026-08-16. */
const REACT_LYNX_MS: Record<string, string> = {
  empty_startup: '0.2',
  create_1k: '12.6',
  create_10k: '166.7',
  update_1k: '3.6',
  update_10k: '34.2',
}

describe('krausest keyed table: ReactLynx (octane harness) vs lynx-solid', () => {
  it('create + update, 1k and 10k rows', { timeout: 30000 }, async () => {
    const empty = await medianCreate(SCENES.empty!)
    const c1k = await medianCreate(SCENES.rows1k!)
    const c10k = await medianCreate(SCENES.rows10k!)
    const u1k = await medianUpdate(SCENES.rows1k!)
    const u10k = await medianUpdate(SCENES.rows10k!)

    console.log('')
    console.log('=== krausest keyed table (9-sample median, in-process, cheap fake PAPI) ===')
    console.log('')
    console.log('metric            | react-lynx (octane) | lynx-solid (ours) | ratio')
    console.log('------------------|--------------------|-------------------|------')
    console.log(`empty_startup ms   | ${REACT_LYNX_MS.empty_startup!.padEnd(18)} | ${empty.ms.toFixed(1).padEnd(17)} | ${(empty.ms / Number(REACT_LYNX_MS.empty_startup)).toFixed(1)}×`)
    console.log(`create_1k_rows ms  | ${REACT_LYNX_MS.create_1k!.padEnd(18)} | ${c1k.ms.toFixed(1).padEnd(17)} | ${(c1k.ms / Number(REACT_LYNX_MS.create_1k)).toFixed(1)}×`)
    console.log(`create_10k_rows ms | ${REACT_LYNX_MS.create_10k!.padEnd(18)} | ${c10k.ms.toFixed(1).padEnd(17)} | ${(c10k.ms / Number(REACT_LYNX_MS.create_10k)).toFixed(1)}×`)
    console.log(`update_1k_rows ms  | ${REACT_LYNX_MS.update_1k!.padEnd(18)} | ${u1k.toFixed(1).padEnd(17)} | ${(u1k / Number(REACT_LYNX_MS.update_1k)).toFixed(1)}×`)
    console.log(`update_10k_rows ms | ${REACT_LYNX_MS.update_10k!.padEnd(18)} | ${u10k.toFixed(1).padEnd(17)} | ${(u10k / Number(REACT_LYNX_MS.update_10k)).toFixed(1)}×`)
    console.log('')
    console.log(`checks: 1k rows → ${c1k.nodes} nodes, ${c1k.tokens} event tokens; 10k rows → ${c10k.nodes} nodes, ${c10k.tokens} tokens (expected ≈ 9008/2000, 90008/20000)`)
    console.log('react-lynx: @lynx-js/react@0.123.0 Snapshot backend; figures are a reference baseline measured on one machine — re-measure before comparing.')
    console.log('lynx-solid: fork template pipeline, real ops JSON serialization; both sides omit BG boot + IPC.')
    console.log('')
  })
})
