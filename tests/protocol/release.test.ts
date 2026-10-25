/**
 * RELEASE protocol — the MT id-mapping lifetime fix.
 *
 * Contract under test:
 *  - removeNode (destroy path) collects every MT id dying with the subtree
 *    (skeleton instances release their reserved range; plain nodes release
 *    their CREATE id) and ships RELEASE runs AFTER the subtree REMOVE;
 *  - reparent/text-slot REMOVEs keep their mapping (keyed revive contract)
 *    and therefore ship no RELEASE;
 *  - on the MT, RELEASE drops `elements[id]` and every later op targeting a
 *    released id degrades to the existing unknown-id no-op.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { flushNow, resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import {
  insert,
  registerTemplate,
  resetLynxTemplateState,
} from '../../packages/runtime/src/background/lynx-template'
import { nodeOps, resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { iterOps, OP } from '../../packages/runtime/src/internal/ops'
import { elements } from '../../packages/runtime/src/main-thread/element-registry'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { installFakePapi } from '../helpers/fake-papi'

function decode(batch: unknown[]): number[][] {
  const out: number[][] = []
  for (const frame of iterOps(batch))
    out.push(frame as unknown as number[])
  return out
}

describe('RELEASE protocol', () => {
  beforeEach(() => {
    installFakePapi()
    resetApplyOpsState()
    resetNodeOpsState()
    resetLynxTemplateState()
    resetOpsBuffer()
    resetFlushState()
  })

  it('walks RELEASE frames through iterOps', () => {
    const frames = [...iterOps([OP.RELEASE, 42, 3])]
    expect(frames).toEqual([[OP.RELEASE, 42, 3]])
  })

  it('drops MT id mappings for the released range', () => {
    applyOps([OP.CREATE, 5, 'view', OP.CREATE, 6, 'view'])
    expect(elements[5]).toBeDefined()
    expect(elements[6]).toBeDefined()

    applyOps([OP.RELEASE, 5, 2])
    expect(elements[5]).toBeUndefined()
    expect(elements[6]).toBeUndefined()
  })

  it('degrades post-release ops to no-ops (stale INSERT never crashes)', () => {
    applyOps([OP.CREATE, 5, 'view', OP.CREATE, 6, 'view'])
    // REMOVE then RELEASE — the wire order removeNode guarantees.
    applyOps([OP.REMOVE, 5, 6, OP.RELEASE, 5, 2])
    expect(elements[5]).toBeUndefined()
    expect(elements[6]).toBeUndefined()

    expect(() => applyOps([OP.SET_CLASS, 5, 'gone'])).not.toThrow()
    expect(() => applyOps([OP.INSERT, 1, 5, -1])).not.toThrow()
    expect(() => applyOps([OP.RELEASE, 900, 100])).not.toThrow()
    expect(elements[5]).toBeUndefined()
  })

  it('warns when INSERT targets a released id (cross-batch revive)', () => {
    vi.stubGlobal('__DEV__', true)
    applyOps([OP.CREATE, 5, 'view'])
    applyOps([OP.RELEASE, 5, 1])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    applyOps([OP.INSERT, 1, 5, -1])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('released id 5'))
    expect(() => applyOps([OP.INSERT, 1, 600, -1])).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1) // unknown id (never released) stays silent
    warn.mockRestore()
    vi.unstubAllGlobals()
  })

  it('removeNode ships REMOVE before a RELEASE for a plain node', () => {
    const batches: unknown[][] = []
    setOpsExecutor(b => batches.push([...b]))

    const parent = nodeOps.createElement('view')
    const child = nodeOps.createElement('view')
    nodeOps.insertNode(parent, child)
    flushNow()
    batches.length = 0

    nodeOps.removeNode(parent, child)
    flushNow()

    expect(batches.length).toBe(1)
    const frames = decode(batches[0])
    const rm = frames.findIndex(f => f[0] === OP.REMOVE)
    const rel = frames.findIndex(f => f[0] === OP.RELEASE)
    expect(rm).toBeGreaterThanOrEqual(0)
    expect(rel).toBeGreaterThan(rm)
    expect(frames[rel]).toEqual([OP.RELEASE, child.id, 1])
  })

  it('releases the whole skeleton range when a template instance dies', () => {
    const batches: unknown[][] = []
    setOpsExecutor(b => batches.push([...b]))

    const tmpl = registerTemplate(987654, { anchors: [], nodeCount: 3 })
    const inst = tmpl()
    const parent = nodeOps.createElement('view')
    nodeOps.insertNode(parent, inst)
    flushNow()
    batches.length = 0

    nodeOps.removeNode(parent, inst)
    flushNow()

    expect(batches.length).toBe(1)
    const frames = decode(batches[0])
    const rm = frames.find(f => f[0] === OP.REMOVE)
    const rel = frames.find(f => f[0] === OP.RELEASE)
    expect(rm).toEqual([OP.REMOVE, parent.id, inst.id])
    // inst.id === firstId — the reserved run [firstId, firstId+3) dies with it.
    expect(rel).toEqual([OP.RELEASE, inst.id, 3])
  })

  it('does not release on reparent (move keeps the mapping)', () => {
    const batches: unknown[][] = []
    setOpsExecutor(b => batches.push([...b]))

    const a = nodeOps.createElement('view')
    const b = nodeOps.createElement('view')
    const child = nodeOps.createElement('view')
    nodeOps.insertNode(a, child)
    flushNow()
    batches.length = 0

    nodeOps.insertNode(b, child) // move a → b
    flushNow()

    const frames = decode(batches[0] ?? [])
    expect(frames.some(f => f[0] === OP.RELEASE)).toBe(false)
    expect(frames.some(f => f[0] === OP.REMOVE)).toBe(true)
  })

  it('releases dynamic text hanging under a template cell (staticCache, id outside the reserved range)', () => {
    // Regression: dynamic children of template cells live under the
    // instance root's staticCache (id-carriers deliberately unlinked from
    // the shadow chain) with ids OUTSIDE [firstId, firstId+nodeCount). A
    // chain-only dying walk never saw them — the MT kept elements[textId]
    // forever, pinning the detached row DOM (the sustained-bench leak:
    // elements[] grew by one raw-text entry per cell, ~4.7MB per 1k rows).
    const batches: unknown[][] = []
    setOpsExecutor(b => batches.push([...b]))

    const tmpl = registerTemplate(987654, { anchors: [], nodeCount: 3 })
    const inst = tmpl()
    const firstId = inst.templateRef!.firstId // as: test-assertion only, templateRef is always set by tmpl()
    const parent = nodeOps.createElement('view')
    nodeOps.insertNode(parent, inst)
    // Push nextId past the reserved run so the text id leaves a gap —
    // releases must ship as two runs (range + the outside id).
    nodeOps.createElement('view')
    const text = nodeOps.createTextNode('hi')
    insert(inst, firstId + 1, text)
    expect(text.id).toBeGreaterThan(firstId + 3)
    flushNow()
    applyOps(batches[0])
    expect(elements[text.id]).toBeDefined()
    batches.length = 0

    nodeOps.removeNode(parent, inst)
    flushNow()

    const frames = decode(batches[0])
    const rm = frames.find(f => f[0] === OP.REMOVE)
    expect(rm).toEqual([OP.REMOVE, parent.id, inst.id])
    const relRuns = frames.filter(f => f[0] === OP.RELEASE)
    expect(relRuns).toEqual([
      [OP.RELEASE, firstId, 3],
      [OP.RELEASE, text.id, 1],
    ])
    // REMOVE must precede RELEASE on the wire (detach, then drop mappings).
    expect(frames.findIndex(f => f[0] === OP.RELEASE)).toBeGreaterThan(
      frames.findIndex(f => f[0] === OP.REMOVE),
    )

    applyOps(batches[0])
    expect(elements[text.id]).toBeUndefined()
  })
})
