import { beforeEach, describe, expect, it } from 'vitest'
import { nodeOps, resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer, takeOps } from '../../packages/runtime/src/background/ops-buffer'
import {
  resetShadowState,
  ShadowElement,
} from '../../packages/runtime/src/background/shadow-element'
import { OP } from '../../packages/runtime/src/internal/ops'

describe('insertNode anchor ownership (BG fails fast, MT stays lenient)', () => {
  beforeEach(() => {
    resetOpsBuffer()
    resetNodeOpsState()
    resetShadowState()
    ShadowElement.nextId = 100
  })

  it('throws when the anchor is owned by a different parent', () => {
    const parent = new ShadowElement('view')
    const other = new ShadowElement('view')
    const foreign = new ShadowElement('view')
    other.appendChild(foreign)
    const node = new ShadowElement('view')
    expect(() => nodeOps.insertNode(parent, node, foreign)).toThrow(
      /not a child/,
    )
    // The throw happens before any emit: nothing ships for a bad anchor.
    expect(takeOps()).toEqual([])
  })

  it('allows unowned anchors (static id-carriers live on the MT only)', () => {
    // lynx-template staticNode: id-only stand-in, never linked into a BG
    // chain (parent === null). The MT resolves its position by id.
    const parent = new ShadowElement('view')
    const carrier = new ShadowElement('view')
    const node = new ShadowElement('view')
    nodeOps.insertNode(parent, node, carrier)
    expect(takeOps()).toEqual([OP.INSERT, parent.id, node.id, carrier.id])
  })

  it('emits INSERT with the owned anchor id', () => {
    const parent = new ShadowElement('view')
    const tail = new ShadowElement('view')
    parent.appendChild(tail)
    const node = new ShadowElement('view')
    nodeOps.insertNode(parent, node, tail)
    expect(takeOps()).toEqual([OP.INSERT, parent.id, node.id, tail.id])
  })

  it('accepts an owned BG-only marker and resolves past it', () => {
    const parent = new ShadowElement('view')
    const marker = new ShadowElement('#marker')
    parent.appendChild(marker)
    const node = new ShadowElement('view')
    // Owned marker: no throw; nothing materialized after it, so tail append.
    nodeOps.insertNode(parent, node, marker)
    expect(takeOps()).toEqual([OP.INSERT, parent.id, node.id, -1])
  })
})
