import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectSubtreeSigns,
  resetShadowState,
  ShadowElement,
} from '../../packages/runtime/src/background/shadow-element'
import { PAGE_ROOT_ID } from '../../packages/runtime/src/internal/ops'

function childrenOf(node: ShadowElement): number[] {
  const ids: number[] = []
  let c = node.firstChild
  while (c) {
    ids.push(c.id)
    c = c.next
  }
  return ids
}

describe('shadowElement tree', () => {
  beforeEach(() => {
    resetShadowState()
  })

  it('reserves id 1 for the page root and allocates from 2', () => {
    const page = new ShadowElement('page', PAGE_ROOT_ID)
    const a = new ShadowElement('view')
    const b = new ShadowElement('text')
    expect(page.id).toBe(1)
    expect(a.id).toBe(2)
    expect(b.id).toBe(3)
  })

  it('appendChild links both directions', () => {
    const page = new ShadowElement('page', PAGE_ROOT_ID)
    const a = new ShadowElement('view')
    const b = new ShadowElement('view')
    page.appendChild(a)
    page.appendChild(b)

    expect(childrenOf(page)).toEqual([a.id, b.id])
    expect(a.parent).toBe(page)
    expect(b.parent).toBe(page)
    expect(a.next).toBe(b)
    expect(b.prev).toBe(a)
    expect(page.lastChild).toBe(b)
  })

  it('insertBefore puts a node before the anchor', () => {
    const page = new ShadowElement('page', PAGE_ROOT_ID)
    const a = new ShadowElement('view')
    const b = new ShadowElement('view')
    const c = new ShadowElement('view')
    page.appendChild(a)
    page.appendChild(b)
    page.insertBefore(c, b)

    expect(childrenOf(page)).toEqual([a.id, c.id, b.id])
    expect(c.prev).toBe(a)
    expect(c.next).toBe(b)
  })

  it('insertBefore with null anchor appends', () => {
    const page = new ShadowElement('page', PAGE_ROOT_ID)
    const a = new ShadowElement('view')
    const b = new ShadowElement('view')
    page.appendChild(a)
    page.insertBefore(b, null)

    expect(childrenOf(page)).toEqual([a.id, b.id])
  })

  it('removeChild relinks the sibling chain', () => {
    const page = new ShadowElement('page', PAGE_ROOT_ID)
    const a = new ShadowElement('view')
    const b = new ShadowElement('view')
    const c = new ShadowElement('view')
    page.appendChild(a)
    page.appendChild(b)
    page.appendChild(c)
    page.removeChild(b)

    expect(childrenOf(page)).toEqual([a.id, c.id])
    expect(a.next).toBe(c)
    expect(c.prev).toBe(a)
    expect(b.parent).toBeNull()
    expect(b.prev).toBeNull()
    expect(b.next).toBeNull()
  })

  it('removeChild is a no-op when the child belongs elsewhere', () => {
    const page = new ShadowElement('page', PAGE_ROOT_ID)
    const other = new ShadowElement('view')
    const a = new ShadowElement('view')
    page.appendChild(a)
    page.removeChild(other)

    expect(childrenOf(page)).toEqual([a.id])
  })

  it('collectSubtreeSigns gathers signs from the whole subtree', () => {
    const root = new ShadowElement('view')
    const a = new ShadowElement('text')
    const b = new ShadowElement('text')
    root.appendChild(a)
    a.appendChild(b)
    root.eventSigns ??= new Set()
    b.eventSigns ??= new Set()
    root.eventSigns.add('solid:0')
    b.eventSigns.add('solid:1')

    expect(collectSubtreeSigns(root)).toEqual(['solid:0', 'solid:1'])
  })
})
