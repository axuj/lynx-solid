import type { FakeEl } from '../helpers/fake-papi'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetLynxTemplateState, style } from '../../packages/runtime/src/background/lynx-template'
import { nodeOps, resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer, takeOps } from '../../packages/runtime/src/background/ops-buffer'
import { ShadowElement } from '../../packages/runtime/src/background/shadow-element'
import { OP, PAGE_ROOT_ID } from '../../packages/runtime/src/internal/ops'
import { elements } from '../../packages/runtime/src/main-thread/element-registry'
import { applyOps } from '../../packages/runtime/src/main-thread/ops-apply'
import { installFakePapi } from '../helpers/fake-papi'
import '../../packages/runtime/src/main-thread/index'

describe('style() full object parity with solid2 dom', () => {
  beforeEach(() => {
    resetOpsBuffer()
    resetNodeOpsState()
    resetRegistry()
    resetLynxTemplateState()
    installFakePapi()
    globalThis.renderPage?.()
    ShadowElement.nextId = 100
  })

  function mtEl(id: number): FakeEl {
    return elements[id] as unknown as FakeEl
  }
  function pump(): void {
    applyOps(takeOps())
  }
  function makeEl(id: number): ShadowElement {
    applyOps([OP.CREATE, id, 'view', OP.INSERT, PAGE_ROOT_ID, id, -1])
    takeOps()
    return new ShadowElement('view', id)
  }

  it('ShadowElement: object diff adds keys and removes disappeared', () => {
    const el = makeEl(50)
    // first call with two keys
    style(el, { color: 'red', width: '10px' }, undefined)
    pump()
    expect(mtEl(50).style).toMatchObject({ color: 'red', width: '10px' })
    // update with only color changed, width removed
    style(el, { color: 'blue' }, { color: 'red', width: '10px' })
    pump()
    // color updated, width removed (cleared to '')
    expect(mtEl(50).style.color).toBe('blue')
    // width should be cleared -> '' in fake (via removeProperty)
    expect(mtEl(50).style.width).toBe('')
  })

  it('ShadowElement: null clears all', () => {
    const el = makeEl(51)
    style(el, { color: 'red', display: 'block' }, undefined)
    pump()
    expect(mtEl(51).style.color).toBe('red')
    style(el, null, { color: 'red', display: 'block' })
    pump()
    expect(mtEl(51).style.color).toBe('')
    expect(mtEl(51).style.display).toBe('')
  })

  it('ShadowElement: string replaces whole style', () => {
    const el = makeEl(52)
    style(el, { color: 'red' }, undefined)
    pump()
    expect(mtEl(52).style.color).toBe('red')
    style(el, 'color: blue; width: 20px', { color: 'red' })
    pump()
    // string should have replaced; fake stores string in attrs.style, but style dict cleared?
    // At least color from previous object should be gone or overwritten; we check attrs
    expect(mtEl(52).attrs.style).toBe('color: blue; width: 20px')
  })

  it('ShadowElement: string -> object clears previous string', () => {
    const el = makeEl(53)
    style(el, 'color: red; width: 10px', undefined)
    pump()
    expect(mtEl(53).attrs.style).toBe('color: red; width: 10px')
    style(el, { color: 'blue' }, 'color: red; width: 10px')
    pump()
    expect(mtEl(53).style.color).toBe('blue')
    // width from previous string should not persist
    expect(mtEl(53).style.width).toBeUndefined()
  })

  it('numeric id: object diff', () => {
    makeEl(60)
    style(60, { color: 'red', width: '10px' }, undefined)
    pump()
    expect(mtEl(60).style).toMatchObject({ color: 'red', width: '10px' })
    style(60, { color: 'blue' }, { color: 'red', width: '10px' })
    pump()
    expect(mtEl(60).style.color).toBe('blue')
    expect(mtEl(60).style.width).toBe('')
  })

  it('numeric id: null clears', () => {
    makeEl(61)
    style(61, { color: 'red' }, undefined)
    pump()
    expect(mtEl(61).style.color).toBe('red')
    style(61, null, { color: 'red' })
    pump()
    expect(mtEl(61).style.color).toBe('')
  })

  it('nodeOps setProperty style diff', () => {
    const el = new ShadowElement('view')
    // need to insert it so MT has it
    applyOps([OP.CREATE, el.id, 'view', OP.INSERT, PAGE_ROOT_ID, el.id, -1])
    takeOps()
    nodeOps.setProperty(el, 'style', { color: 'red', width: '10px' } as any, undefined)
    pump()
    expect(mtEl(el.id).style).toMatchObject({ color: 'red', width: '10px' })
    nodeOps.setProperty(el, 'style', { color: 'blue' } as any, { color: 'red', width: '10px' } as any)
    pump()
    expect(mtEl(el.id).style.color).toBe('blue')
    expect(mtEl(el.id).style.width).toBe('')
  })

  it('nodeOps string -> object', () => {
    const el = new ShadowElement('view')
    applyOps([OP.CREATE, el.id, 'view', OP.INSERT, PAGE_ROOT_ID, el.id, -1])
    takeOps()
    nodeOps.setProperty(el, 'style', 'color: red; width: 10px' as any, undefined)
    pump()
    expect(mtEl(el.id).attrs.style).toBe('color: red; width: 10px')
    nodeOps.setProperty(el, 'style', { color: 'blue' } as any, 'color: red; width: 10px' as any)
    pump()
    expect(mtEl(el.id).style.color).toBe('blue')
    expect(mtEl(el.id).style.width).toBeUndefined()
  })

  it('BG emits removal as a full object without the dropped key', () => {
    // Decisive for the native merge-vs-replace question: whatever the MT
    // does with it, the BG must ship the key's absence. If this fails, the
    // bug is in our diff layer, not the engine.
    const el = makeEl(70)
    style(el, { aspectRatio: '1.5', filter: 'blur(20px)' }, undefined)
    expect(JSON.stringify(takeOps())).toContain('blur')
    style(el, { aspectRatio: '1.5' }, { aspectRatio: '1.5', filter: 'blur(20px)' })
    const flat = takeOps()
    const setStyleIdx = flat.indexOf(OP.SET_STYLE)
    expect(setStyleIdx).toBeGreaterThanOrEqual(0)
    const shipped = flat[setStyleIdx + 2] as Record<string, unknown>
    expect(shipped).toMatchObject({ aspectRatio: '1.5' })
    expect('filter' in shipped).toBe(false)
  })
})
