import type { MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { nodeOps, resetNodeOpsState } from '../../packages/runtime/src/background/node-ops.js'
import { resetOpsBuffer, takeOps } from '../../packages/runtime/src/background/ops-buffer.js'
import {
  resetShadowState,
  ShadowElement,
} from '../../packages/runtime/src/background/shadow-element.js'
import { OP } from '../../packages/runtime/src/internal/ops.js'

describe('<list> child validation (DEV throw, production silent)', () => {
  let errorSpy: MockInstance

  beforeEach(() => {
    resetOpsBuffer()
    resetNodeOpsState()
    resetShadowState()
    ShadowElement.nextId = 100
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    errorSpy.mockRestore()
  })

  describe('DEV (__DEV__ = true)', () => {
    beforeEach(() => {
      vi.stubGlobal('__DEV__', true)
    })

    it('throws when filling text under <list>', () => {
      const list = nodeOps.createElement('list')
      const text = nodeOps.createTextNode('')
      takeOps() // drain CREATE
      nodeOps.insertNode(list, text)
      expect(takeOps()).toEqual([])
      expect(() => nodeOps.replaceText(text, 'hello')).toThrow(
        /<list>#100 received text child #101/,
      )
      expect(errorSpy).toHaveBeenCalled()
      // CREATE_TEXT + SET_TEXT ship; INSERT never does.
      expect(takeOps()).toEqual([
        OP.CREATE_TEXT,
        text.id,
        OP.SET_TEXT,
        text.id,
        'hello',
      ])
    })

    it('throws when inserting visible text directly under <list>', () => {
      const list = nodeOps.createElement('list')
      const text = nodeOps.createTextNode('hi')
      takeOps() // drain CREATE_TEXT + SET_TEXT
      expect(() => nodeOps.insertNode(list, text)).toThrow(
        /received text child/,
      )
      expect(errorSpy).toHaveBeenCalled()
      expect(takeOps()).toEqual([])
    })

    it('throws when inserting a non-list-item element under <list>', () => {
      const list = nodeOps.createElement('list')
      const view = nodeOps.createElement('view')
      takeOps() // drain CREATEs
      expect(() => nodeOps.insertNode(list, view)).toThrow(
        /received element <view>/,
      )
      expect(errorSpy).toHaveBeenCalled()
      expect(takeOps()).toEqual([])
    })

    it('stays silent for framework bookkeeping: empty placeholders and list-items', () => {
      const list = nodeOps.createElement('list')
      const slot = nodeOps.createTextNode('')
      const item = nodeOps.createElement('list-item')
      takeOps() // drain CREATEs
      expect(() => nodeOps.insertNode(list, slot)).not.toThrow()
      expect(() => nodeOps.insertNode(list, item)).not.toThrow()
      expect(errorSpy).not.toHaveBeenCalled()
      expect(takeOps()).toEqual([OP.INSERT, list.id, item.id, -1])
    })

    it('stays silent for text under ordinary parents', () => {
      const view = nodeOps.createElement('view')
      const text = nodeOps.createTextNode('')
      takeOps() // drain CREATE
      nodeOps.insertNode(view, text)
      expect(() => nodeOps.replaceText(text, 'hi')).not.toThrow()
      expect(errorSpy).not.toHaveBeenCalled()
      expect(takeOps()).toEqual([
        OP.CREATE_TEXT,
        text.id,
        OP.SET_TEXT,
        text.id,
        'hi',
        OP.INSERT,
        view.id,
        text.id,
        -1,
      ])
    })
  })

  describe('production (__DEV__ = false)', () => {
    beforeEach(() => {
      vi.stubGlobal('__DEV__', false)
    })

    it('keeps filled text off the MT without throwing', () => {
      const list = nodeOps.createElement('list')
      const text = nodeOps.createTextNode('')
      takeOps() // drain CREATE
      nodeOps.insertNode(list, text)
      expect(() => nodeOps.replaceText(text, 'hello')).not.toThrow()
      expect(errorSpy).not.toHaveBeenCalled()
      expect(takeOps()).toEqual([
        OP.CREATE_TEXT,
        text.id,
        OP.SET_TEXT,
        text.id,
        'hello',
      ])
    })

    it('passes non-list-item elements through unchanged', () => {
      const list = nodeOps.createElement('list')
      const view = nodeOps.createElement('view')
      takeOps() // drain CREATEs
      expect(() => nodeOps.insertNode(list, view)).not.toThrow()
      expect(errorSpy).not.toHaveBeenCalled()
      expect(takeOps()).toEqual([OP.INSERT, list.id, view.id, -1])
    })
  })

  it('treats an undefined __DEV__ as production (no throw)', () => {
    // No stubGlobal here: the typeof guard must fall back to PROD behavior
    // (unit tests without DefinePlugin, prebuilt dist without our plugin).
    const list = nodeOps.createElement('list')
    const text = nodeOps.createTextNode('')
    takeOps() // drain CREATE
    nodeOps.insertNode(list, text)
    expect(() => nodeOps.replaceText(text, 'hello')).not.toThrow()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
