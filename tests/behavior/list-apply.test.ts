import type { ListItemEntry } from '../../packages/runtime/src/main-thread/list-apply'
import type { FakeEl, FakePapiHost } from '../helpers/fake-papi'
import { beforeEach, describe, expect, it } from 'vitest'
import { setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { render, renderer } from '../../packages/runtime/src/background/renderer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { OP } from '../../packages/runtime/src/internal/ops'
import { elements } from '../../packages/runtime/src/main-thread/element-registry'
import {
  diffListItems,
  flushListUpdates,
  getListItemBgIdsForTest,

  longestIncreasingSubsequence,
  resetListState,
  setPlatformInfoProp,
} from '../../packages/runtime/src/main-thread/list-apply'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { flushPromises } from '../helpers/async'
import { installFakePapi } from '../helpers/fake-papi'
import '../../packages/runtime/src/main-thread/index'

const g = globalThis

function getEl(id: number): FakeEl | undefined {
  return elements[id] as FakeEl | undefined
}

describe('list-apply', () => {
  let host: FakePapiHost

  beforeEach(() => {
    resetOpsBuffer()
    resetShadowState()
    resetNodeOpsState()
    resetApplyOpsState()
    resetListState()
    host = installFakePapi()
  })

  it('lIS picks a longest increasing subsequence', () => {
    expect(longestIncreasingSubsequence([0, 1, 2, 3]).size).toBe(4)
    expect(longestIncreasingSubsequence([3, 2, 1]).size).toBe(1)
    expect(longestIncreasingSubsequence([]).size).toBe(0)
  })

  it('diffs removals/insertions/stayers between two item orders', () => {
    const a: ListItemEntry = { el: { uid: 1 } as unknown as ListItemEntry['el'], bgId: 10 }
    const b: ListItemEntry = { el: { uid: 2 } as unknown as ListItemEntry['el'], bgId: 11 }
    const c: ListItemEntry = { el: { uid: 3 } as unknown as ListItemEntry['el'], bgId: 12 }
    const r = diffListItems([a, b, c], [a, c, b])
    expect(r.removeAction).toEqual([2])
    expect(r.insertAction).toEqual([{ position: 1, bgId: 12 }])
    expect([...r.stayedBgIds].sort()).toEqual([10, 11])
  })

  it('cREATE list uses __CreateList; list-item platform props are intercepted', () => {
    applyOps([
      OP.CREATE,
      5,
      'list',
      OP.CREATE,
      6,
      'list-item',
      OP.INSERT,
      5,
      6,
      -1,
      OP.SET_PROP,
      6,
      'item-key',
      'k1',
      OP.SET_PROP,
      6,
      'estimated-main-axis-size-px',
      160,
    ])

    expect(host.createCalls.some(c => c.tag === 'list')).toBe(true)
    expect(getEl(5)?.type).toBe('list')
    // list-item never becomes a child of the native list (dataSource contract)
    expect(getEl(5)?.children).toEqual([])
    expect(getListItemBgIdsForTest(5)).toEqual([6])

    const listEl = getEl(5)!
    expect(listEl.attrs['update-list-info']).toMatchObject({
      insertAction: [
        {
          'position': 0,
          'type': 'list-item',
          'item-key': 'k1',
          'estimated-main-axis-size-px': 160,
        },
      ],
      removeAction: [],
      updateAction: [],
    })
  })

  it('insertListItem moves an existing item (same-list move)', () => {
    applyOps([
      OP.CREATE,
      5,
      'list',
      OP.CREATE,
      6,
      'list-item',
      OP.CREATE,
      7,
      'list-item',
      OP.INSERT,
      5,
      6,
      -1,
      OP.INSERT,
      5,
      7,
      -1,
    ])
    expect(getListItemBgIdsForTest(5)).toEqual([6, 7])
    // move 7 before 6 (anchor = 6)
    applyOps([OP.INSERT, 5, 7, 6])
    expect(getListItemBgIdsForTest(5)).toEqual([7, 6])
    // remove 6
    applyOps([OP.REMOVE, 5, 6])
    expect(getListItemBgIdsForTest(5)).toEqual([7])
  })

  it('componentAtIndex appends the content root to the native list and flushes', () => {
    applyOps([
      OP.CREATE,
      5,
      'list',
      OP.CREATE,
      6,
      'list-item',
      OP.INSERT,
      5,
      6,
      -1,
      OP.SET_PROP,
      6,
      'item-key',
      'k1',
      OP.CREATE,
      7,
      'view',
      OP.INSERT,
      6,
      7,
      -1,
    ])
    const cbs = host.listCallbacks[0]!
    expect(typeof cbs.componentAtIndex).toBe('function')
    const flushBefore = host.flushCount
    const sign = cbs.componentAtIndex!(getEl(5), 99, 0, 42)
    // vue-lynx semantics: the cell hosts the <list-item> element itself
    expect(sign).toBe(getEl(6)?.uid)
    expect(getEl(5)?.children.map(c => c.uid)).toEqual([getEl(6)?.uid])
    expect(host.flushCount).toBeGreaterThan(flushBefore)
  })

  it('flushListUpdates emits updateAction for dirty platform info on stayers', () => {
    applyOps([
      OP.CREATE,
      5,
      'list',
      OP.CREATE,
      6,
      'list-item',
      OP.INSERT,
      5,
      6,
      -1,
      OP.SET_PROP,
      6,
      'item-key',
      'k1',
    ])
    // First flush already cleared dirty — re-dirty and re-flush
    setPlatformInfoProp(6, 'estimated-main-axis-size-px', 200)
    flushListUpdates()
    const listEl = getEl(5)!
    const info = listEl.attrs['update-list-info'] as {
      updateAction: Array<{ from: number, to: number, type: string }>
    }
    expect(info.updateAction).toContainEqual(
      expect.objectContaining({ from: 0, to: 0, type: 'list-item' }),
    )
  })

  it('removeListItem cleans item state', () => {
    applyOps([
      OP.CREATE,
      5,
      'list',
      OP.CREATE,
      6,
      'list-item',
      OP.INSERT,
      5,
      6,
      -1,
      OP.SET_PROP,
      6,
      'item-key',
      'k1',
    ])
    applyOps([OP.REMOVE, 5, 6])
    expect(getListItemBgIdsForTest(5)).toEqual([])
    // no update-list-info entry for the removed item
    const listEl = getEl(5)!
    const info = listEl.attrs['update-list-info'] as { insertAction: unknown[] }
    expect(info.insertAction).toEqual([])
  })

  it('list-item children insert into the detached item (normal path)', () => {
    applyOps([
      OP.CREATE,
      5,
      'list',
      OP.CREATE,
      6,
      'list-item',
      OP.INSERT,
      5,
      6,
      -1,
      OP.CREATE,
      7,
      'view',
      OP.INSERT,
      6,
      7,
      -1,
    ])
    expect(getEl(6)?.children.map(c => c.type)).toEqual(['view'])
  })

  it('end-to-end: Solid render (list + For) → ops → MT list', async () => {
    g.renderPage?.()
    setOpsExecutor(ops => applyOps(ops))

    render(() => {
      const list = renderer.createElement('list')
      const item = renderer.createElement('list-item')
      renderer.setProp(item, 'item-key', 'a')
      renderer.insert(item, () => 'x')
      renderer.insert(list, () => [item])
      return list
    })
    await flushPromises()

    const listEl = host.root.children.find(c => c.type === 'list')
    expect(listEl).toBeDefined()
    // list-item stays out of the native tree until componentAtIndex
    expect(listEl!.children).toEqual([])
    const info = listEl!.attrs['update-list-info'] as {
      insertAction: Array<{ 'item-key': string, 'position': number }>
    }
    expect(info.insertAction).toEqual([
      { 'position': 0, 'type': 'list-item', 'item-key': 'a' },
    ])
    // native pulls the item via componentAtIndex
    const cbs = host.listCallbacks[0]!
    cbs.componentAtIndex!(listEl, 1, 0, 7)
    expect(listEl!.children.length).toBe(1)
  })
})
