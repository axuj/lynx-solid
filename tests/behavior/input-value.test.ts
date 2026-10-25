import type { FakeEl, FakePapiHost } from '../helpers/fake-papi'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  publishEvent,
  register,
  resetRegistry,
} from '../../packages/runtime/src/background/event-registry'
import { resetFlushState } from '../../packages/runtime/src/background/flush'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { OP } from '../../packages/runtime/src/internal/ops'
import { elements } from '../../packages/runtime/src/main-thread/element-registry'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { installFakePapi } from '../helpers/fake-papi'

/** elements[id] returns the engine type; tests need the fake's fields. */
function getEl(id: number): FakeEl | undefined {
  return elements[id] as FakeEl | undefined
}

/**
 * Executable spec for input value handling:
 *
 *  1. routing: value in the CREATE batch rides `default-value` (pre-flush,
 *     no LynxUI yet); value in a later batch is a synchronous setValue —
 *     the engine-contract translation that must stay mechanical.
 *  2. dispatch: the runtime never filters input events — same-value
 *     programmatic echoes reach handlers (web/device parity is the app's
 *     equality guard; see temperature-converter's handlers for the engine
 *     echo quirk).
 */
describe('input value routing and dispatch', () => {
  let host: FakePapiHost

  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
    resetApplyOpsState()
    host = installFakePapi()
  })

  it('delivers every input event, including same-value programmatic echoes', () => {
    const calls: string[] = []
    const sign = register(data => calls.push(JSON.stringify(data)))

    publishEvent(sign, { detail: { value: '-16.67' } })
    publishEvent(sign, { detail: { value: '-16.67' } })

    // Two identical deliveries — the runtime performs no same-value drop;
    // a second listener and an engine echo must both see the event.
    expect(calls).toHaveLength(2)
    expect(JSON.parse(calls[0])).toEqual({ detail: { value: '-16.67' } })
  })

  it('routes value by batch membership: default-value on create, setValue after', () => {
    // Same batch as CREATE — pre-flush the node has no LynxUI, so the
    // first-render channel is the engine's `default-value` prop.
    applyOps([OP.CREATE, 10, 'input', OP.SET_PROP, 10, 'value', '0'])
    const el = getEl(10)!
    expect(el.attrs['default-value']).toBe('0')
    expect(el.attrs.value).toBe('0') // generic attr line — the web channel
    expect(host.invokeCalls).toEqual([])

    // A later batch targets an element flushed in an earlier batch:
    // synchronous `setValue`, no default-value rewrite.
    applyOps([OP.SET_PROP, 10, 'value', '7'])
    expect(host.invokeCalls).toEqual([
      { uid: el.uid, method: 'setValue', params: { value: '7' } },
    ])
    expect(el.attrs.value).toBe('7')
    expect(el.attrs['default-value']).toBe('0')
  })
})
