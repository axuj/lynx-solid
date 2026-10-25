import type { TtBridge } from '../../packages/runtime/src/background/entry'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'
import {
  initBackground,
  installBridge,

} from '../../packages/runtime/src/background/entry'
import {
  publishEvent,
  register,
  resetRegistry,
} from '../../packages/runtime/src/background/event-registry'
import {
  resetFlushState,
  scheduleFlush,
  setOpsExecutor,
} from '../../packages/runtime/src/background/flush'
import { pushOp, resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { OP } from '../../packages/runtime/src/internal/ops'
import { flushPromises } from '../helpers/async'

describe('background entry wiring', () => {
  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    globalThis.publishEvent = undefined
    globalThis.updatePage = undefined
  })

  it('routes tt.publishEvent into the sign registry', () => {
    const tt: TtBridge = {}
    installBridge(tt)

    const calls: unknown[] = []
    const sign = register((e: unknown) => calls.push(e))

    expect(tt.publishEvent).toBeTypeOf('function')
    tt.publishEvent!(sign, { x: 1 })
    expect(calls).toEqual([{ x: 1 }])
  })

  it('routes tt.publicComponentEvent into the sign registry (cid discarded)', () => {
    const tt: TtBridge = {}
    installBridge(tt)

    const calls: unknown[] = []
    const sign = register((e: unknown) => calls.push(e))

    expect(tt.publicComponentEvent).toBeTypeOf('function')
    tt.publicComponentEvent!('component-7', sign, { y: 2 })
    expect(calls).toEqual([{ y: 2 }])
  })

  it('falls back to a plain global publishEvent for legacy SDKs', () => {
    installBridge({})

    const calls: unknown[] = []
    const sign = register((e: unknown) => calls.push(e))

    const g = globalThis
    expect(g.publishEvent).toBeTypeOf('function');
    (g.publishEvent as (sign: string, data: unknown) => void)(sign, {
      z: 3,
    })
    expect(calls).toEqual([{ z: 3 }])
  })

  it('keeps an already-installed executor (tests) instead of clobbering it', async () => {
    const received: unknown[][] = []
    setOpsExecutor(ops => received.push(ops))

    initBackground()

    pushOp(OP.CREATE_PAGE)
    scheduleFlush()
    await flushPromises()
    expect(received).toEqual([[OP.CREATE_PAGE]])
  })

  it('installs the default transport when no executor is present', () => {
    initBackground()
    // No nativeApp in this environment → the default transport drops batches
    // silently; it must merely exist and not throw.
    expect(publishEvent).toBeTypeOf('function')
  })

  it('provides the updatePage stub the Lepus runtime expects', () => {
    initBackground()

    const g = globalThis
    expect(g.updatePage).toBeTypeOf('function')
    expect(() => (g.updatePage as () => void)()).not.toThrow()
  })

  // The BG bootstrap is a top-level side-effect module: the plugin prepends it
  // to every background entry, so a second `initBackground()` there would
  // initialize the background thread twice. That was a real defect (an
  // accidental leftover) — it stayed invisible only because `initBackground()`
  // happened to be idempotent. Both halves are pinned here so neither can
  // regress silently:
  //   1. the bootstrap calls it exactly once (source-level), and
  //   2. `initBackground()` stays idempotent (behavioural), so adding a
  //      side effect to it cannot become a double-apply later.
  it('the BG bootstrap calls initBackground exactly once', () => {
    const src = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../packages/runtime/src/background/bootstrap.ts',
      ),
      'utf8',
    )
    // Comments mention the name; only code lines count.
    const code = src
      .split('\n')
      .filter(line => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
      .join('\n')
    const calls = code.match(/\binitBackground\s*\(\s*\)/g) ?? []
    expect(calls).toHaveLength(1)
  })

  it('initBackground is idempotent (a second call changes nothing)', () => {
    const tt: TtBridge = {}
    initBackground()
    const first = {
      publishEvent: tt.publishEvent,
      globalPublish: globalThis.publishEvent,
      updatePage: globalThis.updatePage,
    }
    // The registry is the one place a non-idempotent side effect would show
    // up (a handler registered per call). Snapshot it so adding such a
    // side effect later fails here instead of silently doubling.
    const registry = (
      globalThis as unknown as {
        __LYNX_SOLID_EVENT_REGISTRY__?: {
          signCounter: number
          handlers: Map<string, unknown>
        }
      }
    ).__LYNX_SOLID_EVENT_REGISTRY__
    const signsBefore = registry?.signCounter
    const handlersBefore = registry?.handlers.size

    initBackground()

    expect(tt.publishEvent).toBe(first.publishEvent)
    expect(globalThis.publishEvent).toBe(first.globalPublish)
    // `updatePage` is a fresh closure each call, but it must stay a no-op stub.
    expect(globalThis.updatePage).toBeTypeOf('function')
    expect(() => (globalThis.updatePage as () => void)()).not.toThrow()
    expect(registry?.signCounter).toBe(signsBefore)
    expect(registry?.handlers.size).toBe(handlersBefore)

    // The event bridge must still route exactly one delivery per publish.
    const calls: unknown[] = []
    const sign = register((e: unknown) => calls.push(e))
    ;(globalThis.publishEvent as (sign: string, data: unknown) => void)(sign, { n: 1 })
    expect(calls).toEqual([{ n: 1 }])
  })
})
