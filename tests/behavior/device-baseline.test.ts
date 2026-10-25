/**
 * Device baseline contract (replaces the old core-js gap-list smoke):
 * the runtime ships NO polyfills — the device (PrimJS) baseline is ≈ES2020
 * built-ins (what the official docs mark as available).
 *
 * Guard layers, strongest first:
 *   1. `lib: ES2020` in packages/runtime/tsconfig.json — typed usage of the
 *      ES2021+ gaps (Object.hasOwn / Array.at / replaceAll) does not compile;
 *   2. this file's source scan — belt against untyped escapes (as-any,
 *      index-signature writes) and against re-introducing the core-js
 *      dependency itself;
 *   3. the runtime's only global is the `queueMicrotask` guard: solid's mount
 *      path calls the bare identifier (measured — every app dies without it),
 *      while the runtime's own scheduling goes through internal/microtask.ts
 *      (`lynx.queueMicrotask` on the engine, a Promise turn elsewhere). Both
 *      are exercised below; every other host surface is the app's business.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../packages/runtime/src')
// The guard's header documents the baseline (mentions core-js by name);
// everything else must stay free of the dependency.
const SHIM = path.join(SRC, 'internal', 'queue-microtask-shim.ts')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory())
      out.push(...sources(full))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      out.push(full)
  }
  return out
}

describe('polyfill-free device baseline', () => {
  it('no core-js anywhere in runtime sources', () => {
    const offenders = sources(SRC)
      .filter(f => f !== SHIM)
      .filter(f => readFileSync(f, 'utf8').includes('core-js'))
    expect(offenders).toEqual([])
  })

  it('no ES2021+ gap APIs (the PrimJS holes) referenced in sources', () => {
    // lib: ES2020 is the primary guard; this scan is the untyped-escape
    // belt — it matches method-call spellings (arr.at(0), (x as any).at(0),
    // Object['hasOwn'] is intentionally out of scope: not worth the noise).
    const gap = /\.\s*hasOwn\s*\(|\.replaceAll\s*\(|\.\s*at\s*\(/
    const offenders = sources(SRC)
      .filter(f => gap.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the guard installs the engine fallback when the global is missing', async () => {
    const routed: Array<() => void> = []
    vi.stubGlobal('queueMicrotask', undefined)
    vi.stubGlobal('lynx', { queueMicrotask: (cb: () => void) => routed.push(cb) })
    vi.resetModules()
    try {
      await import('../../packages/runtime/src/internal/queue-microtask-shim')
      expect(typeof Reflect.get(globalThis, 'queueMicrotask')).toBe('function')
      let ran = false
      const gt = globalThis as unknown as { queueMicrotask?: (cb: () => void) => void }
      gt.queueMicrotask!(() => {
        ran = true
      })
      // routed through lynx.queueMicrotask, not Promise/native
      expect(routed).toHaveLength(1)
      routed[0]()
      expect(ran).toBe(true)
    }
    finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  it('schedules through the engine host fn when the device provides it', async () => {
    const routed: Array<() => void> = []
    vi.stubGlobal('lynx', { queueMicrotask: (cb: () => void) => routed.push(cb) })
    vi.resetModules()
    try {
      const { scheduleMicrotask } = await import('../../packages/runtime/src/internal/microtask')
      let ran = false
      scheduleMicrotask(() => {
        ran = true
      })
      // routed through lynx.queueMicrotask, not Promise/native
      expect(routed).toHaveLength(1)
      expect(ran).toBe(false)
      routed[0]()
      expect(ran).toBe(true)
    }
    finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  it('falls back to a Promise turn when the host has no microtask fn', async () => {
    vi.stubGlobal('lynx', {})
    vi.resetModules()
    try {
      const { scheduleMicrotask } = await import('../../packages/runtime/src/internal/microtask')
      let ran = false
      scheduleMicrotask(() => {
        ran = true
      })
      expect(ran).toBe(false)
      await Promise.resolve()
      expect(ran).toBe(true)
    }
    finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})
