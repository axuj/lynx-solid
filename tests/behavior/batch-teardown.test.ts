/**
 * Event teardown is batch-scoped, mirroring the RELEASE holds:
 *
 *  - removeNode DEFERS REMOVE_EVENT + BG unregister to drain;
 *  - a same-batch keyed MOVE (removeNode + insertNode) cancels the pending
 *    teardown — bindings must survive reorders (rows keep their bindtap);
 *  - only destroy ships REMOVE_EVENT, ordered REMOVE < REMOVE_EVENT <
 *    RELEASE: the MT listener removal reads elements[id], which the RELEASE
 *    runs are about to drop.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  publishEvent,
  resetRegistry,
} from '../../packages/runtime/src/background/event-registry'
import { flushNow, resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import {
  registerTemplate,
  resetLynxTemplateState,
  setAttribute,
} from '../../packages/runtime/src/background/lynx-template'
import { nodeOps, resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { iterOps, OP } from '../../packages/runtime/src/internal/ops'

function decode(batch: unknown[]): unknown[][] {
  return [...iterOps(batch)].map(f => f as unknown[])
}

function has(frames: unknown[][], op: number): boolean {
  return frames.some(f => f[0] === op)
}

function indexOf(frames: unknown[][], op: number): number {
  return frames.findIndex(f => f[0] === op)
}

describe('batch-scoped event teardown (hold/cancel like RELEASE)', () => {
  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
    resetLynxTemplateState()
  })

  it('keyed MOVE keeps template bindings alive (no REMOVE_EVENT, handler still fires)', () => {
    const batches: unknown[][] = []
    setOpsExecutor(b => batches.push([...b]))
    let calls = 0

    const tmpl = registerTemplate(987001, { anchors: [], nodeCount: 4 })
    const inst = tmpl()
    setAttribute(inst, inst, 'bindtap', () => calls++)
    const p1 = nodeOps.createElement('view')
    const p2 = nodeOps.createElement('view')
    nodeOps.insertNode(p1, inst)
    flushNow()

    const setup = decode(batches[0])
    const setEvent = setup.find(f => f[0] === OP.SET_EVENT)
    expect(setEvent).toBeDefined()
    const sign = String(setEvent![4])
    publishEvent(sign, {})
    expect(calls).toBe(1)
    batches.length = 0

    nodeOps.removeNode(p1, inst)
    nodeOps.insertNode(p2, inst)
    flushNow()

    const move = decode(batches[0])
    expect(has(move, OP.REMOVE_EVENT)).toBe(false)
    expect(has(move, OP.RELEASE)).toBe(false)
    publishEvent(sign, {})
    expect(calls).toBe(2)
  })

  it('destroy ships REMOVE < REMOVE_EVENT < RELEASE and kills dispatch', () => {
    const batches: unknown[][] = []
    setOpsExecutor(b => batches.push([...b]))
    let calls = 0

    const tmpl = registerTemplate(987002, { anchors: [], nodeCount: 4 })
    const inst = tmpl()
    setAttribute(inst, inst, 'bindtap', () => calls++)
    const p1 = nodeOps.createElement('view')
    nodeOps.insertNode(p1, inst)
    flushNow()
    const sign = String(decode(batches[0]).find(f => f[0] === OP.SET_EVENT)![4])
    publishEvent(sign, {})
    expect(calls).toBe(1)
    batches.length = 0

    nodeOps.removeNode(p1, inst)
    flushNow()

    const frames = decode(batches[0])
    const rm = indexOf(frames, OP.REMOVE)
    const rmEv = indexOf(frames, OP.REMOVE_EVENT)
    const rel = indexOf(frames, OP.RELEASE)
    expect(rm).toBeGreaterThanOrEqual(0)
    expect(rmEv).toBeGreaterThan(rm)
    expect(rel).toBeGreaterThan(rmEv)
    publishEvent(sign, {})
    expect(calls).toBe(1)
  })

  it('keyed MOVE keeps dynamic bindings alive; destroy tears them down in order', () => {
    const batches: unknown[][] = []
    setOpsExecutor(b => batches.push([...b]))
    let calls = 0

    const p1 = nodeOps.createElement('view')
    const p2 = nodeOps.createElement('view')
    const view = nodeOps.createElement('view')
    nodeOps.setProperty(view, 'bindtap', () => calls++)
    nodeOps.insertNode(p1, view)
    flushNow()
    const sign = String(decode(batches[0]).find(f => f[0] === OP.SET_EVENT)![4])
    publishEvent(sign, {})
    expect(calls).toBe(1)
    batches.length = 0

    nodeOps.removeNode(p1, view)
    nodeOps.insertNode(p2, view)
    flushNow()
    expect(has(decode(batches[0]), OP.REMOVE_EVENT)).toBe(false)
    publishEvent(sign, {})
    expect(calls).toBe(2)
    batches.length = 0

    nodeOps.removeNode(p2, view)
    flushNow()
    const frames = decode(batches[0])
    const rm = indexOf(frames, OP.REMOVE)
    const rmEv = indexOf(frames, OP.REMOVE_EVENT)
    expect(rmEv).toBeGreaterThan(rm)
    publishEvent(sign, {})
    expect(calls).toBe(2)
  })

  it('rebinding a template handler releases the superseded sign', () => {
    const batches: unknown[][] = []
    setOpsExecutor(b => batches.push([...b]))
    let first = 0
    let second = 0

    const tmpl = registerTemplate(987003, { anchors: [], nodeCount: 4 })
    const inst = tmpl()
    setAttribute(inst, inst, 'bindtap', () => first++)
    flushNow()
    const sign0 = String(decode(batches[0]).find(f => f[0] === OP.SET_EVENT)![4])
    batches.length = 0

    setAttribute(inst, inst, 'bindtap', () => second++)
    flushNow()
    const sign1 = String(decode(batches[0]).find(f => f[0] === OP.SET_EVENT)![4])
    expect(sign1).not.toBe(sign0)

    // Superseded sign is dead (no registry leak); the fresh one dispatches.
    publishEvent(sign0, {})
    expect(first).toBe(0)
    expect(second).toBe(0)
    publishEvent(sign1, {})
    expect(second).toBe(1)
  })
})
