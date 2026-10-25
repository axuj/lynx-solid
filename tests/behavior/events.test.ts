import { createSignal } from 'solid-js'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  publishEvent,
  resetRegistry,
} from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer, takeOps } from '../../packages/runtime/src/background/ops-buffer'
import {
  createPageRoot,
  renderer,
} from '../../packages/runtime/src/background/renderer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { OP, PAGE_ROOT_ID } from '../../packages/runtime/src/internal/ops'
import { flushPromises } from '../helpers/async'

function collectOps(): unknown[][] {
  const received: unknown[][] = []
  setOpsExecutor(ops => received.push(ops))
  return received
}

describe('event registration (bind props -> SET_EVENT + registry)', () => {
  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
  })

  it('registers a bindtap handler: SET_EVENT op plus live publishEvent dispatch', async () => {
    const received = collectOps()
    const calls: unknown[] = []
    const page = createPageRoot()
    const view = renderer.createElement('view')

    renderer.setProp(view, 'bindtap', (e: unknown) => calls.push(e))
    renderer.insert(page, view)
    await flushPromises()

    expect(received[0]).toEqual([
      OP.CREATE,
      2,
      'view',
      OP.SET_EVENT,
      2,
      'bindEvent',
      'tap',
      'solid:0',
      OP.INSERT,
      PAGE_ROOT_ID,
      2,
      -1,
    ])
    expect(takeOps()).toEqual([])

    publishEvent('solid:0', { x: 1 })
    expect(calls).toEqual([{ x: 1 }])
  })

  it('re-render updates the closure in place: same sign, no new SET_EVENT', async () => {
    const received = collectOps()
    let seen: string | null = null
    const page = createPageRoot()
    const view = renderer.createElement('view')

    renderer.setProp(view, 'bindtap', () => (seen = 'first'))
    renderer.setProp(view, 'bindtap', () => (seen = 'second'))
    renderer.insert(page, view)
    await flushPromises()

    // Only ONE SET_EVENT frame; the sign never changes.
    expect(received[0]).toEqual([
      OP.CREATE,
      2,
      'view',
      OP.SET_EVENT,
      2,
      'bindEvent',
      'tap',
      'solid:0',
      OP.INSERT,
      PAGE_ROOT_ID,
      2,
      -1,
    ])

    publishEvent('solid:0', {})
    expect(seen).toBe('second')
  })

  it('removing the handler sends REMOVE_EVENT and unregisters the sign', async () => {
    const received = collectOps()
    let called = false
    const page = createPageRoot()
    const view = renderer.createElement('view')

    renderer.setProp(view, 'bindtap', () => (called = true))
    renderer.setProp(view, 'bindtap', undefined)
    renderer.insert(page, view)
    await flushPromises()

    expect(received[0]).toEqual([
      OP.CREATE,
      2,
      'view',
      OP.SET_EVENT,
      2,
      'bindEvent',
      'tap',
      'solid:0',
      OP.REMOVE_EVENT,
      2,
      'bindEvent',
      'tap',
      OP.INSERT,
      PAGE_ROOT_ID,
      2,
      -1,
    ])

    publishEvent('solid:0', {})
    expect(called).toBe(false)
  })

  it('removing a subtree unregisters every event sign inside it', async () => {
    const [show, setShow] = createSignal(true)
    const received = collectOps()
    const calls: unknown[] = []
    const page = createPageRoot()
    const view = renderer.createElement('view')
    const child = renderer.createElement('text')

    renderer.setProp(child, 'bindtap', (e: unknown) => calls.push(e))
    renderer.insert(view, child)
    renderer.insert(page, () => (show() ? view : null))
    await flushPromises()

    expect(received[0]).toEqual([
      OP.CREATE,
      2,
      'view',
      OP.CREATE,
      3,
      'text',
      OP.SET_EVENT,
      3,
      'bindEvent',
      'tap',
      'solid:0',
      OP.INSERT,
      2,
      3,
      -1,
      OP.INSERT,
      PAGE_ROOT_ID,
      2,
      -1,
    ])

    setShow(false)
    await flushPromises()
    // Destroy path: subtree REMOVE first (detach), then REMOVE_EVENT at the
    // drain tail (the MT listener removal still needs elements[id]), then
    // the coalesced RELEASE run for the dying ids [2, 3] dropping the
    // mappings — all three travel in the same batch.
    expect(received.at(-1)).toEqual([
      OP.REMOVE,
      PAGE_ROOT_ID,
      2,
      OP.REMOVE_EVENT,
      3,
      'bindEvent',
      'tap',
      OP.RELEASE,
      2,
      2,
    ])

    publishEvent('solid:0', {})
    expect(calls).toEqual([])
  })

  it('a removed element can be re-registered with a fresh sign', async () => {
    const received = collectOps()
    let called = false
    const page = createPageRoot()
    const view = renderer.createElement('view')

    renderer.setProp(view, 'bindtap', () => (called = true))
    renderer.setProp(view, 'bindtap', undefined)
    renderer.setProp(view, 'bindtap', () => (called = true))
    renderer.insert(page, view)
    await flushPromises()

    const frames = received[0] as unknown[]
    const firstSign = frames.indexOf(OP.SET_EVENT)
    expect(frames.slice(firstSign, firstSign + 5)).toEqual([
      OP.SET_EVENT,
      2,
      'bindEvent',
      'tap',
      'solid:0',
    ])
    const secondEvent = frames.lastIndexOf(OP.SET_EVENT)
    expect(frames.slice(secondEvent, secondEvent + 5)).toEqual([
      OP.SET_EVENT,
      2,
      'bindEvent',
      'tap',
      'solid:1',
    ])

    publishEvent('solid:1', {})
    expect(called).toBe(true)
  })
})

describe('event name normalization (parseEventKey: bindX/catchX -> lynx engine names)', () => {
  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
  })

  function eventOps(received: unknown[][]): unknown[] {
    const frame = received[0] as unknown[]
    const idx = frame.indexOf(OP.SET_EVENT)
    return frame.slice(idx, idx + 5)
  }

  it('bindscroll registers the engine "scroll" event', async () => {
    const received = collectOps()
    const page = createPageRoot()
    const view = renderer.createElement('view')
    let calls = 0
    renderer.setProp(view, 'bindscroll', () => (calls += 1))
    renderer.insert(page, view)
    await flushPromises()
    expect(eventOps(received)).toEqual([OP.SET_EVENT, 2, 'bindEvent', 'scroll', 'solid:0'])
    publishEvent('solid:0', {})
    expect(calls).toBe(1)
  })

  it('bindtouchstart registers the engine name "touchstart" untouched', async () => {
    const received = collectOps()
    const page = createPageRoot()
    const view = renderer.createElement('view')
    renderer.setProp(view, 'bindtouchstart', () => {})
    renderer.insert(page, view)
    await flushPromises()
    expect(eventOps(received)).toEqual([OP.SET_EVENT, 2, 'bindEvent', 'touchstart', 'solid:0'])
  })

  it('catchtap registers "tap" on its own catchEvent slot (no bubbling)', async () => {
    const received = collectOps()
    const page = createPageRoot()
    const view = renderer.createElement('view')
    renderer.setProp(view, 'catchtap', () => {})
    renderer.insert(page, view)
    await flushPromises()
    expect(eventOps(received)).toEqual([OP.SET_EVENT, 2, 'catchEvent', 'tap', 'solid:0'])
  })

  it('non-event props keep the plain SET_PROP path', async () => {
    const received = collectOps()
    const page = createPageRoot()
    const view = renderer.createElement('view')
    renderer.setProp(view, 'data-x', 'v')
    renderer.setProp(view, 'id', 'a')
    renderer.insert(page, view)
    await flushPromises()
    const frames = received.flat()
    expect(frames).toContain(OP.SET_PROP)
    expect(frames).not.toContain(OP.SET_EVENT)
  })

  it('event-named props with non-function values are ignored (no event, no prop)', async () => {
    const received = collectOps()
    const page = createPageRoot()
    const view = renderer.createElement('view')
    renderer.setProp(view, 'bindtap', 42)
    renderer.insert(page, view)
    await flushPromises()
    expect(received.flat()).not.toContain(OP.SET_EVENT)
  })

  it('dOM-style on* names are plain props, not events', async () => {
    const received = collectOps()
    const page = createPageRoot()
    const view = renderer.createElement('view')
    renderer.setProp(view, 'onScroll', () => {})
    renderer.setProp(view, 'onClick', () => {})
    renderer.insert(page, view)
    await flushPromises()
    expect(received.flat()).not.toContain(OP.SET_EVENT)
  })
})
