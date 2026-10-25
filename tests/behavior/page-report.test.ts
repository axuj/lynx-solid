/**
 * `<page>` ownership report — a second concurrent wrapper must not throw, it
 * reports through the engine's `lynx.reportError` (and through `console.error`
 * on hosts without `lynx`).
 *
 * Why this exists: the reporting path was dead for months — it read
 * `globalThis.lynx`, which does not exist on the BG (the engine object arrives
 * as a `RuntimeWrapperWebpackPlugin` parameter), so every report silently fell
 * back to `console.error`.
 *
 * Node cannot reproduce that difference (`globalThis.lynx` and the bare `lynx`
 * are the same binding here), so the behavioral cases below only pin the call
 * shape — Error + `{ level: 'warning' }` — and the console fallback. The read
 * itself is pinned by the source scan, which is what a regression to
 * `globalThis.lynx` would trip.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { Page } from '../../packages/runtime/src/background/page'
import { render, renderer } from '../../packages/runtime/src/background/renderer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'

describe('<page> ownership report', () => {
  let dispose: (() => void) | undefined

  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
    setOpsExecutor(() => {})
  })

  afterEach(() => {
    dispose?.()
    dispose = undefined
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Two wrappers under one `render()`: the first claims, the second reports. */
  function mountTwoPages(): void {
    dispose = render(() => {
      // Called directly, not via createComponent: `Page` returns `unknown`
      // (it hands back `props.children`), which createComponent's Component
      // type rejects. A direct call keeps the owner, so hooks/context work.
      Page({})
      Page({})
      return renderer.createElement('view')
    })
  }

  it('reports the second wrapper through lynx.reportError as a warning', () => {
    const calls: unknown[][] = []
    vi.stubGlobal('lynx', {
      reportError: (...args: unknown[]) => calls.push(args),
    })

    mountTwoPages()

    expect(calls).toHaveLength(1)
    const [error, options] = calls[0]
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('more than one <page>')
    expect(options).toEqual({ level: 'warning' })
  })

  it('reads the bare lynx binding, never the global', () => {
    // The BG gets `lynx` as a wrapper parameter; `globalThis.lynx` does not
    // exist there, so the global read is what broke this path.
    const src = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../packages/runtime/src/background/page.ts',
      ),
      'utf8',
    )
    // Comments in that file mention the old read; scan code lines only.
    const code = src
      .split('\n')
      .filter(line => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(code).toContain('typeof lynx')
    expect(code).not.toMatch(/globalThis[^\n]*\.lynx\b/)
  })

  it('falls back to console.error when the host has no lynx', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    mountTwoPages()

    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.[0])).toContain('more than one <page>')
  })
})
