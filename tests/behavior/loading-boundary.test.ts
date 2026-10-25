import { createMemo, Loading } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
// Compiled call shape: the fork compiler emits insert/createComponent against
// the lynx-template module — replicate that here (no babel in this test).
import {
  createComponent,
  insert,
} from '../../packages/runtime/src/background/lynx-template'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer, takeOps } from '../../packages/runtime/src/background/ops-buffer'
import {
  render,
  renderer,
} from '../../packages/runtime/src/background/renderer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { OP } from '../../packages/runtime/src/internal/ops'
import { flushPromises } from '../helpers/async'

function collectOps(): unknown[][] {
  const received: unknown[][] = []
  setOpsExecutor(ops => received.push(ops))
  return received
}

/** All SET_TEXT values currently present in received ops. */
function textValues(received: unknown[][]): string[] {
  const out: string[] = []
  for (const batch of received) {
    for (let i = 0; i < batch.length; i++) {
      if (batch[i] === OP.SET_TEXT)
        out.push(String(batch[i + 2]))
    }
  }
  return out
}

/** <text>{children}</text> via the universal renderer (op-emitting). */
function Text(children: () => unknown) {
  const el = renderer.createElement('text')
  insert(el as import('../../packages/runtime/src/background/lynx-template').LynxTemplateInstance, el, children, null)
  return el
}

describe('Loading boundary over async memo (compiled call shape)', () => {
  let dispose: (() => void) | undefined

  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
  })

  afterEach(() => {
    dispose?.()
    dispose = undefined
  })

  it('shows fallback while async memo is pending, then swaps to children', async () => {
    const received = collectOps()

    let releaseData: ((v: string[]) => void) | undefined
    const gate = new Promise<string[]>((resolve) => {
      releaseData = resolve
    })

    dispose = render(() => {
      // async memo — same shape as TimelinePage's timeline
      const timeline = createMemo(async () => await gate)

      const pageView = renderer.createElement('view')

      // header — OUTSIDE the boundary; must appear during pending
      insert(pageView as never, pageView, () => Text(() => 'header'), null)

      // Loading boundary wrapping a child that READS the pending memo
      insert(pageView as never, pageView, createComponent(Loading, {
        get fallback() {
          return Text(() => 'loading…')
        },
        get children() {
          // reads the memo synchronously during render — throws NotReadyError
          // while the gate is shut; boundary must catch it and show fallback
          return Text(() => (timeline() as string[]).join(','))
        },
      }), null)

      return pageView
    })

    await flushPromises()

    expect(textValues(received)).toContain('header')
    expect(textValues(received)).toContain('loading…')
    expect(textValues(received)).not.toContain('post-a')

    releaseData?.(['post-a', 'post-b'])
    await flushPromises()

    expect(textValues(received)).toContain('post-a,post-b')
    expect(takeOps()).toEqual([])
  })
})
