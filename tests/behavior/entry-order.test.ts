/**
 * Eval-order guard: the queueMicrotask guard must be the FIRST value import of
 * every entry that installs it. solid's mount path calls the bare identifier
 * (`onHydrationEnd` runs on every render), so the global has to exist before
 * solid evaluates — and it is the runtime's ONLY global (every other host
 * surface belongs to the app, docs/guide/mt-ifr.mdx rule 1). The bundler
 * entries must likewise lead with bootstrap (BG) / mainThreadEntry (MT) or the
 * guard never runs on that thread. Conventions rot; this test does not.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** First value (non-`type`) import specifier of a source file, or null. */
function firstValueImport(file: string): string | null {
  const src = readFileSync(path.join(ROOT, file), 'utf8')
  const lines = src.split(/\r?\n/)
  let inMultiLine = false
  for (const line of lines) {
    const t = line.trimStart()
    if (!inMultiLine) {
      if (!t.startsWith('import '))
        continue
      if (t.startsWith('import type'))
        continue // erased at compile time — no runtime ordering impact
      const quoted = /['"]([^'"]+)['"]/.exec(line)
      if (quoted)
        return quoted[1] // side-effect import or single-line `from`
      inMultiLine = true // named import wraps — find its `from` below
      continue
    }
    const from = /\bfrom\s+['"]([^'"]+)['"]/.exec(line)
    if (from)
      return from[1]
  }
  return null
}

describe('entry eval order (queueMicrotask guard installs first)', () => {
  it.each([
    'packages/runtime/src/background/bootstrap.ts',
    'packages/runtime/src/index.ts',
  ])('%s leads with the guard', (file) => {
    expect(firstValueImport(file)).toMatch(/internal\/queue-microtask-shim$/)
  })

  it.each([
    'packages/runtime/src/main-thread/index.ts',
    'packages/runtime/src/main-thread/ifr-runtime.ts',
  ])('%s installs no global (the MT context provides queueMicrotask itself)', (file) => {
    const src = readFileSync(path.join(ROOT, file), 'utf8')
    expect(src).not.toContain('queue-microtask-shim')
  })

  it('plugin prepends the thread entry to every bundler entry array', () => {
    const src = readFileSync(path.join(ROOT, 'packages/plugin/src/index.ts'), 'utf8')
    expect(src).toMatch(/import:\s*\[\s*backgroundBootstrap\b/)
    expect(src).toMatch(/import:\s*\[\s*mainThreadEntry\b/)
  })
})
