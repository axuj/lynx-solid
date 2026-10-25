import { createSignal, For } from 'solid-js'

import { beforeEach, describe, expect, it } from 'vitest'
import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetLynxTemplateState } from '../../packages/runtime/src/background/lynx-template'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { createPageRoot, render, renderer } from '../../packages/runtime/src/background/renderer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { iterOps, OP } from '../../packages/runtime/src/internal/ops'
import { flushPromises } from '../helpers/async'
import { installFakePapi } from '../helpers/fake-papi'
import '../../packages/runtime/src/main-thread/index'

/**
 * Regression: the universal renderer's keyed MOVE detaches via removeNode
 * and re-inserts the same node later in the same batch (bench-table swap
 * reproduced it: REMOVE → RELEASE → INSERT of the same id → silently
 * dropped mapping → one row vanished). Batch-scoped holds + insertNode
 * cancel must keep moves RELEASE-free while real destroys still release.
 */
function resetAll(): void {
  resetOpsBuffer()
  resetFlushState()
  resetShadowState()
  resetRegistry()
  resetNodeOpsState()
  resetLynxTemplateState()
}

function countFrames(batches: unknown[][], code: number): number {
  let n = 0
  for (const batch of batches) {
    for (const frame of iterOps(batch)) {
      if (frame[0] === code)
        n++
    }
  }
  return n
}

describe('keyed move vs RELEASE (batch-scoped holds)', () => {
  beforeEach(() => {
    installFakePapi()
    resetAll()
    createPageRoot()
  })

  it('reordering a For emits no RELEASE and keeps every row attached', async () => {
    const batches: unknown[][] = []
    setOpsExecutor(b => batches.push([...b]))
    const [items, setItems] = createSignal(
      Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })),
    )

    render(() => {
      const view = renderer.createElement('view')
      renderer.insert(view, () => For({
        get each() {
          return items()
        },
        children: (item: { id: number }) => {
          const row = renderer.createElement('view')
          renderer.insert(row, () => `row ${item.id}`)
          return row
        },
      }))
      return view
    })
    await flushPromises()
    expect(countFrames(batches, OP.RELEASE)).toBe(0)

    batches.length = 0
    setItems((prev) => {
      const next = prev.slice()
      const a = next[1]
      next[1] = next[8]
      next[8] = a
      return next
    })
    await flushPromises()

    // The move must not release — and every INSERT of a moved id must keep
    // its mapping (a dropped one loses the row on the MT).
    expect(countFrames(batches, OP.RELEASE)).toBe(0)
    expect(countFrames(batches, OP.REMOVE)).toBeGreaterThan(0)
    expect(countFrames(batches, OP.INSERT)).toBeGreaterThan(0)
  })

  it('a real destroy still ships REMOVE + RELEASE at drain', async () => {
    const batches: unknown[][] = []
    setOpsExecutor(b => batches.push([...b]))
    const [show, setShow] = createSignal(true)

    render(() => {
      const view = renderer.createElement('view')
      renderer.insert(view, () => {
        if (show()) {
          const el = renderer.createElement('view')
          renderer.insert(el, () => 'body')
          return el
        }
        return null
      })
      return view
    })
    await flushPromises()
    batches.length = 0

    setShow(false)
    await flushPromises()

    expect(countFrames(batches, OP.RELEASE)).toBe(1)
    const flat = batches.flat()
    const codes: number[] = []
    for (const frame of iterOps(flat))
      codes.push(frame[0] as number)
    // RELEASE trails the batch (drain order), never precedes REMOVE.
    expect(codes.lastIndexOf(OP.RELEASE)).toBeGreaterThan(codes.lastIndexOf(OP.REMOVE))
  })
})
