import { beforeEach, describe, expect, it } from 'vitest'
import {
  enqueueWorklet,
  flushNow,
  isFlushScheduled,
  resetFlushState,
  scheduleFlush,
  setOpsExecutor,
} from '../../packages/runtime/src/background/flush'
import {
  pushOp,
  resetOpsBuffer,
  takeOps,
} from '../../packages/runtime/src/background/ops-buffer'
import { OP } from '../../packages/runtime/src/internal/ops'
import { flushPromises } from '../helpers/async'

describe('ops buffer + flush', () => {
  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
  })

  it('delivers a whole batch in order', async () => {
    const received: unknown[][] = []
    setOpsExecutor(ops => received.push(ops))

    pushOp(OP.CREATE_PAGE)
    pushOp(OP.CREATE, 2, 'view')
    pushOp(OP.SET_TEXT, 3, 'hello')
    scheduleFlush()

    await flushPromises()

    expect(received).toEqual([
      [OP.CREATE_PAGE, OP.CREATE, 2, 'view', OP.SET_TEXT, 3, 'hello'],
    ])
  })

  it('drains the buffer after each flush', async () => {
    const received: unknown[][] = []
    setOpsExecutor(ops => received.push(ops))

    pushOp(OP.CREATE_PAGE)
    scheduleFlush()
    await flushPromises()

    pushOp(OP.SET_TEXT, 2, 'again')
    scheduleFlush()
    await flushPromises()

    expect(received).toEqual([[OP.CREATE_PAGE], [OP.SET_TEXT, 2, 'again']])
    expect(takeOps()).toEqual([])
  })

  it('coalesces multiple scheduleFlush calls into one delivery', async () => {
    const received: unknown[][] = []
    setOpsExecutor(ops => received.push(ops))

    pushOp(OP.CREATE, 2, 'view')
    scheduleFlush()
    scheduleFlush()
    scheduleFlush()
    expect(isFlushScheduled()).toBe(true)

    await flushPromises()

    expect(received).toHaveLength(1)
    expect(isFlushScheduled()).toBe(false)
  })

  it('does not call the executor when the batch is empty', async () => {
    let calls = 0
    setOpsExecutor(() => {
      calls++
    })

    scheduleFlush()
    await flushPromises()

    expect(calls).toBe(0)
  })

  it('is safe without an executor installed', async () => {
    pushOp(OP.CREATE, 2, 'view')
    scheduleFlush()
    await flushPromises()
    expect(takeOps()).toEqual([])
  })

  it('flushNow delivers ops and worklets synchronously in one batch', () => {
    const batches: Array<{ ops: unknown[][], worklets?: unknown }> = []
    setOpsExecutor((ops, worklets) => {
      batches.push({ ops: [ops], worklets })
    })

    pushOp(OP.INIT_MT_REF, 1, null)
    enqueueWorklet({ worklet: { _wkltId: 'w' }, params: [1], resolveId: 7 })
    flushNow()

    expect(batches).toHaveLength(1)
    expect(batches[0].ops[0]).toEqual([OP.INIT_MT_REF, 1, null])
    expect(batches[0].worklets).toEqual([
      { worklet: { _wkltId: 'w' }, params: [1], resolveId: 7 },
    ])
    expect(isFlushScheduled()).toBe(false)
    expect(takeOps()).toEqual([])
  })

  it('flushNow cancels a pending microtask flush (no double delivery)', async () => {
    const received: unknown[][] = []
    setOpsExecutor(ops => received.push(ops))

    pushOp(OP.CREATE, 2, 'view')
    scheduleFlush()
    expect(isFlushScheduled()).toBe(true)

    flushNow()
    expect(isFlushScheduled()).toBe(false)

    await flushPromises()

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual([OP.CREATE, 2, 'view'])
  })

  it('flushNow delivers worklets even when the ops buffer is empty', () => {
    const batches: Array<{ ops: unknown[], worklets?: unknown }> = []
    setOpsExecutor((ops, worklets) => {
      batches.push({ ops, worklets })
    })

    enqueueWorklet({ worklet: { _wkltId: 'only' }, params: [], resolveId: 1 })
    flushNow()

    expect(batches).toHaveLength(1)
    expect(batches[0].ops).toEqual([])
    expect(batches[0].worklets).toHaveLength(1)
  })
})
