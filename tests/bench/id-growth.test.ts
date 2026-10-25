/**
 * Quantifies Main Thread id/registry growth under feed-style churn: the
 * elements registry never releases slots (REMOVE only detaches), so every
 * fresh node id stays addressable forever. Measures, per round:
 *
 *   alive    — nodes reachable from the page root (actually in the tree)
 *   registry — non-undefined slots in the elements registry
 *   leaked   = registry - alive (detached wrappers the registry pins)
 *   maxId    = elements.length - 1 (id address space high-water mark)
 *
 * Scenario A: full refresh (worst case) — 1k rows swapped for fresh keys,
 * 10 rounds. Scenario B: rolling feed — append 10 new rows + trim 10 old,
 * 100 steps. Both run through the real fork pipeline (compile → BG module →
 * ops → applyOps) on the cheap fake PAPI.
 */

import type { FakeEl, FakePapiHost } from '../helpers/fake-papi'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'
import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetLynxTemplateState } from '../../packages/runtime/src/background/lynx-template'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { elements } from '../../packages/runtime/src/main-thread/element-registry'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { registerSkeleton } from '../../packages/runtime/src/main-thread/skeleton-registry'
import { flushPromises } from '../helpers/async'
import { installFakePapi } from '../helpers/fake-papi'

const g = globalThis

function setItems(items: unknown[]): void {
  (globalThis as { __setItems?: (items: unknown[]) => void }).__setItems?.(items)
}

function resetAll(): void {
  resetOpsBuffer()
  resetFlushState()
  resetShadowState()
  resetRegistry()
  resetNodeOpsState()
  resetLynxTemplateState()
  resetApplyOpsState()
}

const feedSrc = `import { render } from '@lynx-solid/runtime'
import { For, createSignal } from 'solid-js'
const [items, setItems] = createSignal<{ id: number; label: string }[]>([])
;(globalThis as any).__setItems = setItems
function FeedApp() {
  return (<view class="feed">
    <For each={items()}>{(row) => (
      <view class="row" id={'row-' + row.id}>
        <text>{row.label}</text>
      </view>
    )}</For>
  </view>)
}
render(() => <FeedApp />)`

const FEED = compileDomModule(feedSrc)

let tmpCounter = 0

async function mount(): Promise<{ host: FakePapiHost, received: unknown[][] }> {
  const host = installFakePapi()
  resetApplyOpsState()
  const createPage = g.__CreatePage as ((componentId: string, cssId: number) => void) | undefined
  createPage?.('0', 0)
  for (const t of FEED.templates) {
    // eslint-disable-next-line no-eval
    registerSkeleton(t.id, eval(`(${t.createCode})`))
  }
  const received: unknown[][] = []
  setOpsExecutor(ops => received.push(ops))
  const file = fileURLToPath(new URL(`../tmp-idgrowth-${tmpCounter++}.mjs`, import.meta.url))
  writeFileSync(
    file,
    FEED.code
      .replaceAll('@lynx-solid/runtime/lynx-template', '../packages/runtime/src/background/lynx-template.ts')
      .replaceAll('@lynx-solid/runtime', '../packages/runtime/src/index.ts'),
  )
  try {
    await import(pathToFileURL(file).href)
  }
  finally {
    rmSync(file, { force: true })
  }
  return { host, received }
}

async function settle(received: unknown[][]): Promise<void> {
  await flushPromises()
  for (const batch of received.splice(0))
    applyOps(batch)
  for (let turn = 0; turn < 8; turn++)
    await Promise.resolve()
}

function countNodes(el: FakeEl): number {
  let n = 1
  for (const c of el.children)
    n += countNodes(c)
  return n
}

function snapshot(host: FakePapiHost): { alive: number, registry: number, leaked: number, maxId: number } {
  const alive = countNodes(host.root)
  let registry = 0
  for (const el of elements) {
    if (el !== undefined)
      registry++
  }
  return { alive, registry, leaked: registry - alive, maxId: elements.length - 1 }
}

function pad(s: string, w: number): string {
  return s.padStart(w)
}

describe('id registry growth under feed-style churn', () => {
  it('scenario A: full refresh — 1k rows swapped for fresh keys, 10 rounds', async () => {
    resetAll()
    const { host, received } = await mount()
    await settle(received)

    const rows = 1000
    const rounds = 10
    console.log('\n=== feed churn A: full refresh (1k rows/round, fresh keys) ===')
    console.log(
      pad('round', 6) + pad('alive', 8) + pad('registry', 10) + pad('leaked', 8) + pad('maxId', 9),
    )
    let lastMaxId = snapshot(host).maxId
    for (let round = 1; round <= rounds; round++) {
      const fresh = Array.from({ length: rows }, (_, i) => ({
        id: round * rows + i,
        label: `item ${round * rows + i}`,
      }))
      setItems(fresh)
      await settle(received)
      setItems([])
      await settle(received)
      const s = snapshot(host)
      console.log(
        pad(String(round), 6) + pad(String(s.alive), 8) + pad(String(s.registry), 10)
        + pad(String(s.leaked), 8) + pad(String(s.maxId), 9),
      )
      lastMaxId = s.maxId
    }
    const s = snapshot(host)
    console.log(
      `\nrounds=${rounds} rows=${rows}: id consumption ~${((s.maxId - 2) / (rounds * rows)).toFixed(1)} ids/row;`
      + ` pinned detached wrappers = ${s.leaked} (registry=${s.registry}, alive=${s.alive})`
      + ` — the pinned wrappers are unreachable but never GC'd.`,
    )
    void lastMaxId
  })

  it('scenario B: rolling feed — append 10 + trim 10, 100 steps', async () => {
    resetAll()
    const { host, received } = await mount()
    await settle(received)

    const batch = 10
    const steps = 100
    console.log('\n=== feed churn B: rolling feed (append 10 / trim 10 per step) ===')
    console.log(
      pad('step', 6) + pad('alive', 8) + pad('registry', 10) + pad('leaked', 8) + pad('maxId', 9),
    )
    let id = 0
    let window: { id: number, label: string }[] = []
    for (let step = 1; step <= steps; step++) {
      const fresh = Array.from({ length: batch }, () => ({
        id: id++,
        label: `item ${id}`,
      }))
      window = [...window.slice(batch), ...fresh]
      setItems(window)
      await settle(received)
      if (step % 10 === 0 || step === steps) {
        const s = snapshot(host)
        console.log(
          pad(String(step), 6) + pad(String(s.alive), 8) + pad(String(s.registry), 10)
          + pad(String(s.leaked), 8) + pad(String(s.maxId), 9),
        )
      }
    }
    const s = snapshot(host)
    console.log(
      `\nsteps=${steps} batch=${batch}: window=${window.length} items,`
      + ` id consumption ~${((s.maxId - 2) / (steps * batch)).toFixed(1)} ids/row;`
      + ` pinned detached wrappers = ${s.leaked}.`,
    )
  })
})
