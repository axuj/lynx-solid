/**
 * Chain-integrity probe (audit dispute A vs C):
 *
 * The compiler emits, for a multi-slot parent `{dynA}<static>{dynB}`
 * (perSlot path, element.ts markerExpr = next sibling's ref id; trailing
 * slot anchored by `_$marker` which APPENDs a #marker to the parent):
 *
 *   1. insert(parentCell, dynA, staticSiblingCell)   // unlinked cell anchor
 *   2. marker()  → parentCell.appendChild(marker)    // lastChild is stale here
 *   3. insert(parentCell, dynB, marker)
 *
 * If appendChild's `else { firstChild = child }` branch (taken when
 * lastChild is null even though firstChild is set) or insertBefore's
 * `anchor.prev === null → firstChild = child` branch orphans the earlier
 * chain, walkSubtree misses dynA → its ids/signs never reach dying/RELEASE
 * (the leak class walkSubtree was built to close).
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { resetFlushState } from '../../packages/runtime/src/background/flush'
import { insert, marker, registerTemplate, resetLynxTemplateState } from '../../packages/runtime/src/background/lynx-template'
import { nodeOps, resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { resetShadowState, walkSubtree } from '../../packages/runtime/src/background/shadow-element'

describe('cell-as-anchor chain integrity', () => {
  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetNodeOpsState()
    resetLynxTemplateState()
  })

  it('walkSubtree reaches every dynamic inserted under a template cell (no orphaning)', () => {
    const tmpl = registerTemplate(555001, { anchors: [], nodeCount: 6 })
    const inst = tmpl()
    const parentCellId = inst.templateRef!.firstId // the view cell (results.id)
    const staticSiblingCell = parentCellId + 2 // a static skeleton sibling's ref id

    const dynA = nodeOps.createElement('view')
    const dynB = nodeOps.createElement('view')

    // Emission order, mirroring compiled output:
    insert(inst, parentCellId, dynA, staticSiblingCell) // 1. splice before an unlinked cell
    const m = marker(inst, parentCellId, 0) // 2. trailing marker appends to the same cell
    insert(inst, parentCellId, dynB, m) // 3. insert before the marker

    const seen = new Set<number>()
    walkSubtree(inst, n => seen.add(n.id))

    // All materialized nodes under the instance must be reachable —
    // otherwise their ids/signs are invisible to dying collection.
    expect(seen.has(dynA.id)).toBe(true)
    expect(seen.has(dynB.id)).toBe(true)
    expect(seen.has(m.id)).toBe(true)
  })

  it('lastChild stays consistent after an unlinked-anchor splice + append', () => {
    const tmpl = registerTemplate(555002, { anchors: [], nodeCount: 6 })
    const inst = tmpl()
    const parentCellId = inst.templateRef!.firstId + 1
    const dynA = nodeOps.createElement('view')
    insert(inst, parentCellId, dynA, parentCellId + 3)

    // A tail walk from firstChild must agree with lastChild.
    let tail = null as unknown
    const cell = inst.staticCache!.get(parentCellId)!
    let cur = cell.firstChild
    while (cur) {
      tail = cur
      cur = cur.next
    }
    expect(tail).toBe(cell.lastChild)
  })
})
