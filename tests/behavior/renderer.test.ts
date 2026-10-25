import { createSignal } from 'solid-js'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer, takeOps } from '../../packages/runtime/src/background/ops-buffer'
import {
  createPageRoot,
  render,
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

describe('renderer (solid universal on shadow tree)', () => {
  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
  })

  it('renders a static tree as CREATE / CREATE_TEXT / SET_TEXT / INSERT ops', async () => {
    const received = collectOps()

    render(() => {
      const view = renderer.createElement('view')
      const text = renderer.createTextNode('hello')
      renderer.insert(view, text)
      return view
    })

    await flushPromises()

    expect(received).toEqual([
      [
        OP.CREATE,
        2,
        'view',
        OP.CREATE_TEXT,
        3,
        OP.SET_TEXT,
        3,
        'hello',
        OP.INSERT,
        2,
        3,
        -1,
        OP.INSERT,
        PAGE_ROOT_ID,
        2,
        -1,
      ],
    ])
    expect(takeOps()).toEqual([])
  })

  it('updates dynamic text through SET_TEXT', async () => {
    const received = collectOps()
    const [count, setCount] = createSignal(0)

    render(() => {
      const view = renderer.createElement('view')
      renderer.insert(view, () => count())
      return view
    })
    await flushPromises()
    expect(received).toHaveLength(1)

    setCount(1)
    await flushPromises()

    expect(received).toEqual([expect.anything(), [OP.SET_TEXT, 3, '1']])
  })

  it('swaps a conditional element with INSERT + REMOVE', async () => {
    const received = collectOps()
    const [show, setShow] = createSignal(true)

    render(() => {
      const view = renderer.createElement('view')
      renderer.insert(view, () =>
        show() ? renderer.createElement('text') : null)
      return view
    })
    await flushPromises()

    setShow(false)
    await flushPromises()
    // destroy path: subtree REMOVE then RELEASE (id 3 dies with it).
    expect(received).toEqual([expect.anything(), [OP.REMOVE, 2, 3, OP.RELEASE, 3, 1]])

    setShow(true)
    await flushPromises()
    expect(received.at(-1)).toEqual([
      OP.CREATE,
      4,
      'text',
      OP.INSERT,
      2,
      4,
      -1,
    ])
  })

  it('removes every child when the value turns null', async () => {
    const received = collectOps()
    const [show, setShow] = createSignal(true)

    render(() => {
      const view = renderer.createElement('view')
      renderer.insert(view, () =>
        show() ? renderer.createElement('text') : null)
      return view
    })
    await flushPromises()

    setShow(false)
    await flushPromises()

    expect(received.at(-1)).toEqual([OP.REMOVE, 2, 3, OP.RELEASE, 3, 1])
    expect(takeOps()).toEqual([])
  })

  it('routes setProperty to SET_CLASS / SET_STYLE / SET_ID / SET_PROP / SET_EVENT', async () => {
    const received = collectOps()
    const page = createPageRoot()
    const view = renderer.createElement('view')

    renderer.setProp(view, 'class', 'card')
    renderer.setProp(view, 'style', { color: 'red' })
    renderer.setProp(view, 'id', 'main')
    renderer.setProp(view, 'data-key', 42)
    renderer.setProp(view, 'bindtap', () => {})
    renderer.insert(page, view)

    await flushPromises()

    expect(received).toEqual([
      [
        OP.CREATE,
        2,
        'view',
        OP.SET_CLASS,
        2,
        'card',
        OP.SET_STYLE,
        2,
        { color: 'red' },
        OP.SET_ID,
        2,
        'main',
        OP.SET_PROP,
        2,
        'data-key',
        42,
        OP.SET_EVENT,
        2,
        'bindEvent',
        'tap',
        'solid:0',
        OP.INSERT,
        PAGE_ROOT_ID,
        2,
        -1,
      ],
    ])
  })
})
