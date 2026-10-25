import type { FakeEl, FakePapiHost } from '../helpers/fake-papi'
import { createSignal } from 'solid-js'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  publishEvent,
  resetRegistry,
} from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer, takeOps } from '../../packages/runtime/src/background/ops-buffer'
import { Page } from '../../packages/runtime/src/background/page'
import {
  render,
  renderer,
} from '../../packages/runtime/src/background/renderer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { OP, PAGE_ROOT_ID } from '../../packages/runtime/src/internal/ops'
import {
  elements,
  getPageUniqueId,
} from '../../packages/runtime/src/main-thread/element-registry'
import {
  createListElement,
  hasItemStateForTest,
  isListParent,
  listItems,
  resetListState,
  setPlatformInfoProp,
} from '../../packages/runtime/src/main-thread/list-apply'
import { applyOps } from '../../packages/runtime/src/main-thread/ops-apply'
import { resetWorkletState } from '../../packages/runtime/src/main-thread/worklet-apply'
import { flushPromises } from '../helpers/async'
import {

  installFakePapi,
  treeText,
} from '../helpers/fake-papi'
import '../../packages/runtime/src/main-thread/index'

const g = globalThis

/** elements[id] returns the engine type; tests need the fake's fields. */
function getEl(id: number): FakeEl | undefined {
  return elements[id] as FakeEl | undefined
}

describe('main thread (ops → PAPI translation)', () => {
  let host: FakePapiHost

  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
    host = installFakePapi()
  })

  it('renderPage creates the root, registers id=1 and presents the frame', () => {
    g.renderPage?.()

    expect(host.root.type).toBe('page')
    expect(elements[PAGE_ROOT_ID]).toBe(host.root)
    expect(getPageUniqueId()).toBe(host.root.uid)
    expect(host.flushCount).toBe(1)
  })

  it('does not alias CREATE page — compile rewrites <page> so this path is a bypass', () => {
    // vue-lynx contract: correct source never emits OP.CREATE page.
    // A raw CREATE page here is a compile bypass; it must hit
    // createElementByType('page') → __CreateElement (engine may reject).
    // We no longer special-case it — Page component + babel rewrite own the path.
    g.renderPage?.()
    const createsBefore = host.createCalls.length

    g.lynxSolidApplyOps?.({
      data: JSON.stringify([
        OP.CREATE,
        2,
        'view',
        OP.INSERT,
        PAGE_ROOT_ID,
        2,
        -1,
      ]),
    })

    expect(host.createCalls.length).toBe(createsBefore + 1)
    expect(host.createCalls.at(-1)?.tag).toBe('view')
    expect(getEl(2)?.type).toBe('view')
    expect(host.root.children.map(c => c.type)).toEqual(['view'])
  })

  it('translates CREATE / CREATE_TEXT / INSERT into the fake element tree', () => {
    g.renderPage?.()

    g.lynxSolidApplyOps?.({
      data: JSON.stringify([
        OP.CREATE,
        2,
        'view',
        OP.CREATE_TEXT,
        3,
        OP.INSERT,
        PAGE_ROOT_ID,
        2,
        -1,
        OP.INSERT,
        2,
        3,
        -1,
      ]),
    })

    expect(getEl(2)?.type).toBe('view')
    // CREATE_TEXT builds a raw-text run (__CreateRawText) — inherits parent styles
    expect(getEl(3)?.type).toBe('rawtext')
    expect(host.root.children.map(c => c.type)).toEqual(['view'])
    expect(host.root.children[0]!.children.map(c => c.type)).toEqual([
      'rawtext',
    ])
    expect(host.createCalls.every(c => c.parentId === host.root.uid)).toBe(
      true,
    )
  })

  it('translates property ops (prop/style/class/id) and SET_TEXT', () => {
    g.renderPage?.()

    g.lynxSolidApplyOps?.({
      data: JSON.stringify([
        OP.CREATE,
        2,
        'view',
        OP.CREATE_TEXT,
        3,
        OP.INSERT,
        PAGE_ROOT_ID,
        2,
        -1,
        OP.INSERT,
        2,
        3,
        -1,
        OP.SET_TEXT,
        3,
        'hi',
        OP.SET_PROP,
        2,
        'data-key',
        42,
        OP.SET_STYLE,
        2,
        { color: 'red' },
        OP.SET_CLASS,
        2,
        'card',
        OP.SET_ID,
        2,
        'main',
      ]),
    })

    const text = getEl(3)!
    expect(treeText(host.root)).toEqual(['hi'])
    expect(text.attrs.text).toBe('hi')
    const view = getEl(2)!
    expect(view.attrs['data-key']).toBe(42)
    expect(view.attrs.style).toEqual({ color: 'red' })
    expect(view.attrs.class).toBe('card')
    expect(view.attrs.id).toBe('main')
  })

  it('translates SET_EVENT / REMOVE_EVENT / REMOVE', () => {
    g.renderPage?.()

    g.lynxSolidApplyOps?.({
      data: JSON.stringify([
        OP.CREATE,
        2,
        'view',
        OP.INSERT,
        PAGE_ROOT_ID,
        2,
        -1,
        OP.SET_EVENT,
        2,
        'bindEvent',
        'tap',
        'solid:0',
        OP.REMOVE_EVENT,
        2,
        'bindEvent',
        'tap',
      ]),
    })

    const view = getEl(2)!
    expect(view.events).toEqual([])

    g.lynxSolidApplyOps?.({
      data: JSON.stringify([OP.REMOVE, PAGE_ROOT_ID, 2]),
    })
    // REMOVE keeps the id mapping: keyed-list updates REMOVE a run then
    // INSERT the survivors back, so the element must stay addressable.
    expect(elements[2]).toBeDefined()
    expect(host.root.children).toEqual([])
  })

  it('routes MT_SET_EVENT eventType untouched to __AddEvent (catch stays catch)', () => {
    g.renderPage?.()

    g.lynxSolidApplyOps?.({
      data: JSON.stringify([
        OP.CREATE,
        2,
        'view',
        OP.INSERT,
        PAGE_ROOT_ID,
        2,
        -1,
        OP.MT_SET_EVENT,
        2,
        'catchEvent',
        'tap',
        { _wkltId: 'w', _c: {} },
      ]),
    })

    const view = getEl(2)!
    expect(view.events).toEqual([
      { eventType: 'catchEvent', eventName: 'tap', sign: { type: 'worklet', value: { _wkltId: 'w', _c: {}, _workletType: 'main-thread' } } },
    ])
  })

  it('unbind deletes the refMap key; rebind recreates it (no leak)', () => {
    g.renderPage?.()
    ;(globalThis as { lynxWorkletImpl?: unknown }).lynxWorkletImpl = {
      _refImpl: { _workletRefMap: {}, updateWorkletRef: () => {} },
    }
    try {
      const refMap = (): Record<number, unknown> =>
        ((globalThis as { lynxWorkletImpl: { _refImpl: { _workletRefMap: Record<number, unknown> } } }).lynxWorkletImpl._refImpl._workletRefMap)
      const apply = (ops: unknown[]) => {
        g.lynxSolidApplyOps?.({ data: JSON.stringify(ops) })
      }
      // Element created once; bind/unbind/rebind only send SET_MT_REF
      // (re-CREATEing id 2 would clobber the fake element mid-test).
      apply([OP.CREATE, 2, 'view', OP.INSERT, PAGE_ROOT_ID, 2, -1])
      apply([OP.SET_MT_REF, 2, 41])
      expect(refMap()[41]).toMatchObject({ _wvid: 41 })
      apply([OP.SET_MT_REF, 2, -1])
      expect(41 in refMap()).toBe(false)
      apply([OP.SET_MT_REF, 2, 41])
      expect(refMap()[41]).toMatchObject({ current: null, _wvid: 41 })
    }
    finally {
      delete (globalThis as { lynxWorkletImpl?: unknown }).lynxWorkletImpl
    }
  })

  it('the MT entry installs no browser-shaped globals (self/window are the app\'s business)', () => {
    // The MT entry installs its own contract (renderPage / processData / …) and
    // engine-surface fills (queueMicrotask), nothing browser-shaped. `self` is
    // needed by TanStack's devtools hook and `window` flips every
    // `typeof window === 'undefined'` probe into "browser" (query-core's
    // `isServer`), so both belong to the app: the router examples install
    // `self` in their own polyfills.ts. This assertion keeps the runtime
    // minimal — see docs/guide/mt-ifr.mdx, rule 1.
    expect('self' in globalThis).toBe(false)
    expect('window' in globalThis).toBe(false)
  })

  it('an IFR-intercepted batch still runs its worklets (the mount hook\'s runOnMainThread)', () => {
    g.renderPage?.()
    const runWorklet = vi.fn()
    ;(globalThis as { lynxWorkletImpl?: unknown }).lynxWorkletImpl = {
      _runRunOnMainThreadTask: runWorklet,
    }
    // What the IFR hook says when the main thread already painted this batch.
    g.__lynxSolidInterceptBgOps = () => true
    try {
      const createsBefore = host.createCalls.length
      g.lynxSolidApplyOps?.({
        data: JSON.stringify([OP.CREATE, 2, 'view', OP.INSERT, PAGE_ROOT_ID, 2, -1]),
        worklets: JSON.stringify([{ worklet: { _wkltId: 'w' }, params: [], resolveId: 7 }]),
      })
      // Ops are not replayed (that is the point of IFR) ...
      expect(host.createCalls.length).toBe(createsBefore)
      // ... but the worklet must run: motion starts its animation from one that
      // rides the background's first flush, and dropping it leaves the MT with
      // a painted but frozen first screen.
      expect(runWorklet).toHaveBeenCalledTimes(1)
      expect(runWorklet.mock.calls[0]![2]).toBe(7)
    }
    finally {
      delete (globalThis as { lynxWorkletImpl?: unknown }).lynxWorkletImpl
      g.__lynxSolidInterceptBgOps = undefined
    }
  })

  it('RELEASE tears down list, ref, and worklet-event state owned by the range', () => {
    g.renderPage?.()
    resetListState()
    resetWorkletState()
    ;(globalThis as { lynxWorkletImpl?: unknown }).lynxWorkletImpl = {
      _refImpl: { _workletRefMap: {}, updateWorkletRef: () => {} },
    }
    try {
      const apply = (ops: unknown[]) => {
        g.lynxSolidApplyOps?.({ data: JSON.stringify(ops) })
      }
      const refMap = (): Record<number, unknown> =>
        ((globalThis as { lynxWorkletImpl: { _refImpl: { _workletRefMap: Record<number, unknown> } } }).lynxWorkletImpl._refImpl._workletRefMap)

      apply([
        OP.CREATE,
        2,
        'view',
        OP.INSERT,
        PAGE_ROOT_ID,
        2,
        -1,
        OP.SET_MT_REF,
        2,
        41,
        OP.MT_SET_EVENT,
        2,
        'bindEvent',
        'tap',
        { _wkltId: 'w', _c: {} },
      ])
      const view = getEl(2)!
      expect(view.events.some(e => e.eventName === 'tap')).toBe(true)
      expect(refMap()[41]).toMatchObject({ _wvid: 41 })

      // List state keyed by ids inside the dying range (list id 7, item id 8).
      createListElement(7)
      setPlatformInfoProp(8, 'item-key', 'k')
      expect(listItems.has(7)).toBe(true)
      expect(isListParent(7)).toBe(true)
      expect(hasItemStateForTest(8)).toBe(true)

      apply([OP.RELEASE, 2, 7]) // range covers ids 2..8

      expect(elements[2]).toBeUndefined()
      // engine worklet listener removed (undefined handler = removal)
      expect(view.events.some(e => e.eventName === 'tap')).toBe(false)
      expect(41 in refMap()).toBe(false)
      expect(listItems.has(7)).toBe(false)
      expect(isListParent(7)).toBe(false)
      expect(hasItemStateForTest(8)).toBe(false)
    }
    finally {
      resetListState()
      resetWorkletState()
      delete (globalThis as { lynxWorkletImpl?: unknown }).lynxWorkletImpl
    }
  })

  it('skips a replayed duplicate batch (double BG bundle evaluation)', () => {
    g.renderPage?.()
    const batch = JSON.stringify([
      OP.CREATE,
      2,
      'view',
      OP.INSERT,
      PAGE_ROOT_ID,
      2,
      -1,
    ])
    const apply = g.lynxSolidApplyOps as (p: { data: string }) => void

    apply({ data: batch })
    const creates = host.createCalls.length
    apply({ data: batch })

    expect(host.createCalls.length).toBe(creates)
    expect(host.root.children).toHaveLength(1)
  })

  it('strict anchors: foreign anchor fails the op instead of appending', () => {
    g.renderPage?.()
    const apply = g.lynxSolidApplyOps as (p: { data: string }) => void
    apply({
      data: JSON.stringify([
        OP.CREATE,
        2,
        'view',
        OP.INSERT,
        PAGE_ROOT_ID,
        2,
        -1,
        OP.CREATE,
        7,
        'view',
        OP.INSERT,
        PAGE_ROOT_ID,
        7,
        -1,
        OP.CREATE,
        3,
        'view',
        OP.INSERT,
        7,
        3,
        -1,
        OP.CREATE,
        4,
        'view',
      ]),
    })
    // Anchor id 3 is known to the registry but is a child of 7, not root —
    // it reaches __InsertElementBefore with a foreign anchor.
    // Lenient by default: appends (historical).
    apply({ data: JSON.stringify([OP.INSERT, PAGE_ROOT_ID, 4, 3]) })
    expect(host.root.children.map(c => c.uid)).toContain(getEl(4)!.uid)

    // Strict: MT's per-op isolation (ops-apply.ts) turns the PAPI throw into
    // a logged op failure, and the child is NOT inserted — nothing lands in
    // the tree behind our back.
    host.strictAnchors = true
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    // NOTE: read mock.calls BEFORE mockRestore — restore resets the call
    // history, so asserting afterwards always sees zero calls.
    apply({
      data: JSON.stringify([
        OP.CREATE,
        5,
        'view',
        OP.INSERT,
        PAGE_ROOT_ID,
        5,
        3,
      ]),
    })
    const logged = spy.mock.calls.flat().join(' ')
    spy.mockRestore()
    expect(host.root.children.map(c => c.uid)).not.toContain(getEl(5)!.uid)
    expect(logged).toContain('[fake-papi]')
  })

  it('appends on unknown anchor id instead of dropping the insert', () => {
    g.renderPage?.()
    const apply = g.lynxSolidApplyOps as (p: { data: string }) => void
    apply({
      data: JSON.stringify([
        OP.CREATE,
        2,
        'view',
        OP.INSERT,
        PAGE_ROOT_ID,
        2,
        -1,
        OP.CREATE,
        3,
        'view',
      ]),
    })
    // Anchor id 9999 was never registered (stale BG reference, replayed
    // batch): content must survive as a tail append, not vanish.
    apply({ data: JSON.stringify([OP.INSERT, PAGE_ROOT_ID, 3, 9999]) })
    expect(host.root.children.map(c => c.uid)).toEqual([
      getEl(2)!.uid,
      getEl(3)!.uid,
    ])
  })

  it('end-to-end in one process: render → ops → apply → event → update', async () => {
    // Full loop through both worlds: Solid render → flush → applyOps → fake
    // engine; then a published event bounces back into reactivity.
    g.renderPage?.()
    setOpsExecutor(ops => applyOps(ops))

    render(() => {
      const [count, setCount] = createSignal(0)
      const view = renderer.createElement('view')
      renderer.insert(view, () => count())
      renderer.setProp(view, 'bindtap', () => setCount(count() + 1))
      return view
    })
    await flushPromises()

    expect(treeText(host.root)).toEqual(['0'])
    const view = host.root.children[0]!
    const sign = view.events[0]!.sign!
    expect(sign).toBe('solid:0')
    expect(host.flushCount).toBeGreaterThanOrEqual(2)

    publishEvent(sign, {})
    await flushPromises()

    expect(treeText(host.root)).toEqual(['1'])
    expect(takeOps()).toEqual([])
  })

  it('Page applies attrs to the engine root and emits no CREATE page', async () => {
    g.renderPage?.()
    const createsBefore = host.createCalls.length
    setOpsExecutor(ops => applyOps(ops))

    render(() => {
      const view = renderer.createElement('view')
      return Page({
        class: 'bg-hn',
        style: 'width:100%',
        get children() {
          return view
        },
      }) as never
    })
    await flushPromises()

    // No second native page — only the view child was created.
    expect(host.createCalls.length).toBe(createsBefore + 1)
    expect(host.createCalls.at(-1)?.tag).toBe('view')
    expect(host.root.attrs.class).toBe('bg-hn')
    expect(String(host.root.attrs.style)).toContain('100%')
    expect(host.root.children.map(c => c.type)).toEqual(['view'])
    expect(host.root.parent).toBeNull()
    expect(takeOps()).toEqual([])
  })
})
