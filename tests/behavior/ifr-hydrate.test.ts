import type { FakeEl, FakePapiHost } from '../helpers/fake-papi'
/**
 * Hydrate delta: the MT reuses the tree it painted and applies only what the
 * Background's first batch changes.
 *
 * Part A pins the frame taxonomy on hand-built streams (what may be patched,
 * what forces a repaint). Part B runs the real pipeline: the same scene
 * rendered twice with different data — the second render plays the Background
 * — and asserts the diff patches the Main Thread's tree *in place*: the
 * Background's values appear, nothing is created and nothing is removed.
 * Part C covers divergence, which must keep the repaint path. Part D runs the
 * repaint path for real: the teardown must keep the page root and the skeleton
 * registry, and the replay that follows must rebuild the screen.
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
import { resetOpsSink } from '../../packages/runtime/src/background/ops-sink'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { OP } from '../../packages/runtime/src/internal/ops'
import { elements } from '../../packages/runtime/src/main-thread/element-registry'
import { hydrateDiff } from '../../packages/runtime/src/main-thread/hydrate'
import { adoptIfrRender, interceptBgOps } from '../../packages/runtime/src/main-thread/ifr'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { hasSkeleton, registerSkeleton } from '../../packages/runtime/src/main-thread/skeleton-registry'
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
import { For, createSignal } from 'solid-js'
const seed = (globalThis as any).__LYNX_SEED__ ?? 0
const [tag] = createSignal(seed === 0 ? 'cold' : 'hot')
const labels = seed === 0 ? ['a', 'b', 'c'] : seed === 2 ? ['a', 'b', 'c', 'd', 'e'] : ['A', 'B', 'C']
function App() {
  return (
    <view class={tag()}>
      <text>head</text>
      <For each={labels}>{(label, i) => <text class={i() % 2 ? 'odd' : 'even'}>{label}</text>}</For>
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

// --- Part A: the frame taxonomy -------------------------------------------

const A_CREATE = [OP.CREATE, 2, 'view']
const A_TEXT = [OP.CREATE_TEXT, 3]
const A_INSERT = [OP.INSERT, 2, 3, -1]

describe('hydrateDiff — frame taxonomy', () => {
  it('identical streams need no patch', () => {
    const ops = [...A_CREATE, ...A_TEXT, ...A_INSERT, OP.SET_PROP, 3, 'text', 'a']
    expect(hydrateDiff(ops, ops)).toEqual({ kind: 'match' })
  })

  it('patches a changed text value', () => {
    const painted = [...A_CREATE, OP.SET_TEXT, 2, 'a']
    const incoming = [...A_CREATE, OP.SET_TEXT, 2, 'A']
    expect(hydrateDiff(painted, incoming)).toEqual({
      kind: 'patch',
      ops: [OP.SET_TEXT, 2, 'A'],
    })
  })

  it('patches changed class, id, style and prop values', () => {
    expect(hydrateDiff([OP.SET_CLASS, 2, 'a'], [OP.SET_CLASS, 2, 'b']))
      .toEqual({ kind: 'patch', ops: [OP.SET_CLASS, 2, 'b'] })
    expect(hydrateDiff([OP.SET_ID, 2, 'x'], [OP.SET_ID, 2, null]))
      .toEqual({ kind: 'patch', ops: [OP.SET_ID, 2, null] })
    expect(hydrateDiff([OP.SET_STYLE, 2, 'color:red'], [OP.SET_STYLE, 2, { color: 'blue' }]))
      .toEqual({ kind: 'patch', ops: [OP.SET_STYLE, 2, { color: 'blue' }] })
    expect(hydrateDiff([OP.SET_PROP, 2, 'text', 'a'], [OP.SET_PROP, 2, 'text', 'b']))
      .toEqual({ kind: 'patch', ops: [OP.SET_PROP, 2, 'text', 'b'] })
  })

  it('patches only what differs, in order', () => {
    const painted = [OP.SET_TEXT, 2, 'a', OP.SET_CLASS, 2, 'x', OP.SET_TEXT, 3, 'b']
    const incoming = [OP.SET_TEXT, 2, 'a', OP.SET_CLASS, 2, 'y', OP.SET_TEXT, 3, 'c']
    expect(hydrateDiff(painted, incoming)).toEqual({
      kind: 'patch',
      ops: [OP.SET_CLASS, 2, 'y', OP.SET_TEXT, 3, 'c'],
    })
  })

  it('treats a different prop key as divergence, not a patch', () => {
    // Patching would set the Background's key and leave the MT's stale one.
    expect(hydrateDiff(
      [OP.SET_PROP, 2, 'text', 'a'],
      [OP.SET_PROP, 2, 'title', 'a'],
    )).toMatchObject({ kind: 'diverge', cause: 'identity' })
  })

  it('never patches an event frame — signs are per-thread registry state', () => {
    expect(hydrateDiff(
      [OP.SET_EVENT, 2, 'bindEvent', 'tap', 'solid:0'],
      [OP.SET_EVENT, 2, 'bindEvent', 'tap', 'solid:1'],
    )).toMatchObject({ kind: 'diverge' })
    // Same sign, same frame: nothing to do.
    expect(hydrateDiff(
      [OP.SET_EVENT, 2, 'bindEvent', 'tap', 'solid:0'],
      [OP.SET_EVENT, 2, 'bindEvent', 'tap', 'solid:0'],
    )).toEqual({ kind: 'match' })
  })

  it('diverges on structure: an extra element, a different parent, a different type', () => {
    expect(hydrateDiff([OP.CREATE, 2, 'view'], [OP.CREATE, 2, 'view', OP.CREATE, 3, 'text']))
      .toMatchObject({ kind: 'diverge', cause: 'length' })
    expect(hydrateDiff([OP.CREATE, 2, 'view'], [OP.CREATE, 2, 'text']))
      .toMatchObject({ kind: 'diverge', cause: 'identity' })
    expect(hydrateDiff(
      [OP.INSERT, 2, 3, -1],
      [OP.INSERT, 2, 3, 4],
    )).toMatchObject({ kind: 'diverge', cause: 'identity' })
    expect(hydrateDiff(
      [OP.INSTANTIATE, 7, [], 2],
      [OP.INSTANTIATE, 8, [], 2],
    )).toMatchObject({ kind: 'diverge', cause: 'identity' })
  })

  it('diverges when the frame kinds part ways', () => {
    expect(hydrateDiff([OP.SET_TEXT, 2, 'a'], [OP.SET_CLASS, 2, 'a']))
      .toMatchObject({ kind: 'diverge', cause: 'frame-kind' })
  })
})

// --- Part B/C: the real pipeline ------------------------------------------

function resetBgSide(): void {
  resetOpsBuffer()
  resetFlushState()
  resetShadowState()
  resetRegistry()
  resetNodeOpsState()
  resetLynxTemplateState()
  resetMainThreadRefState()
  resetOpsSink()
}

/** Render the scene with `seed`; returns the stream the render produced. */
async function renderScene(seed: number): Promise<unknown[]> {
  g.__LYNX_SEED__ = seed
  const received: unknown[][] = []
  setOpsExecutor(ops => received.push(ops))
  const file = fileURLToPath(new URL(`../tmp-hydrate-${counter++}.mjs`, import.meta.url))
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
  return received.flat()
}

interface Recorder {
  calls: unknown[][]
  mark: () => number
  since: (from: number) => unknown[][]
}

/** Record every engine call; element arguments collapse to `type#uid`. */
function recordPapi(): Recorder {
  const calls: unknown[][] = []
  const isEl = (v: unknown): v is FakeEl =>
    typeof v === 'object' && v !== null && 'uid' in v && 'children' in v
  const norm = (v: unknown): unknown =>
    isEl(v) ? `${v.type}#${v.uid}` : Array.isArray(v) ? v.map(norm) : v
  for (const key of Object.keys(globalThis)) {
    if (!key.startsWith('__') || typeof g[key] !== 'function')
      continue
    const fn = g[key] as (...a: unknown[]) => unknown
    g[key] = (...args: unknown[]): unknown => {
      calls.push([key, ...args.map(norm)])
      return fn(...args)
    }
  }
  return {
    calls,
    mark: () => calls.length,
    since: from => calls.slice(from),
  }
}

/** Every label text under the page, in document order. */
function labels(root: FakeEl): string[] {
  const out: string[] = []
  const visit = (n: FakeEl): void => {
    if (n.type === 'text' || n.type === 'rawtext')
      out.push(String(n.attrs.text ?? ''))
    for (const c of n.children) visit(c)
  }
  visit(root)
  return out
}

async function bootPaintedScreen(): Promise<{ host: FakePapiHost, painted: unknown[] }> {
  resetBgSide()
  resetApplyOpsState()
  const host = installFakePapi()
  ;(g.renderPage as () => void)()
  for (const t of scene.templates) {
    // eslint-disable-next-line no-eval
    registerSkeleton(t.id, eval(`(${t.createCode})`))
  }
  const painted = await renderScene(0)
  for (const batch of [painted]) applyOps(batch)
  return { host, painted }
}

describe('hydrate delta through the pipeline', () => {
  it('patches the painted tree in place when only values differ', async () => {
    const { host, painted } = await bootPaintedScreen()
    expect(labels(host.root)).toEqual(['head', 'a', 'b', 'c'])

    // The Background renders the same program later, with data that moved.
    resetBgSide()
    const incoming = await renderScene(1)

    const diff = hydrateDiff(painted, incoming)
    expect(diff.kind).toBe('patch')
    if (diff.kind !== 'patch')
      return
    // A handful of value frames, not a replay: 3 labels + the tag class.
    expect(diff.ops.length).toBeLessThan(20)

    const rec = recordPapi()
    const from = rec.mark()
    applyOps(diff.ops)

    // The Background's values are on screen...
    expect(labels(host.root)).toEqual(['head', 'A', 'B', 'C'])
    expect(host.root.children[0]!.attrs.class).toBe('hot')
    // ...and nothing was rebuilt to get them: no create, no remove, no insert.
    const mutating = rec.since(from).filter(c => ![
      '__SetAttribute',
      '__SetClasses',
      '__SetInlineStyles',
      '__SetID',
      '__FlushElementTree',
    ].includes(String(c[0])))
    expect(mutating).toEqual([])
  })

  it('diverges when the Background renders a different structure', async () => {
    const { painted } = await bootPaintedScreen()

    // Seed 2 makes the Background render five rows where the MT painted three:
    // same program, different structure. Repaint — never guess at alignment.
    resetBgSide()
    const incoming = await renderScene(2)

    expect(hydrateDiff(painted, incoming)).toMatchObject({ kind: 'diverge' })
  })
})

// --- Part D: the repaint path itself --------------------------------------

describe('IFR repaint teardown', () => {
  it('keeps the page root and the skeleton registry so the replay can rebuild', async () => {
    const { host, painted } = await bootPaintedScreen()
    expect(labels(host.root)).toEqual(['head', 'a', 'b', 'c'])

    const templateId = scene.templates[0]!.id
    expect(hasSkeleton(templateId)).toBe(true)
    const page = elements[1]
    expect(page).toBeDefined()

    // Diverging batch: the Background renders five rows, the MT painted three.
    resetBgSide()
    const incoming = await renderScene(2)
    adoptIfrRender(painted)
    expect(interceptBgOps(incoming)).toBe(false)

    // The page root is the one element the teardown must keep. Dropping it
    // (the id used to be read out of the frame stream, where an INSERT's
    // second slot is its parent) left every later INSERT from the Background
    // targeting a parent that no longer existed — a blank first screen with no
    // error anywhere.
    expect(elements[1]).toBe(page)

    // Template registrations are load-time data, not screen state. Clearing
    // them here turned the replay's INSTANTIATE frames into "unknown template"
    // throws for every element.
    expect(hasSkeleton(templateId)).toBe(true)

    // What the caller does next — the replay — must therefore rebuild it.
    applyOps(incoming)
    expect(labels(host.root)).toEqual(['head', 'a', 'b', 'c', 'd', 'e'])
  })
})
