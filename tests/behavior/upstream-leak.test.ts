/**
 * Upstream-leak guard for `@solidjs/web`'s server-function client.
 *
 * rc.18 evaluates `new TextEncoder().encode(':\n\n')` at module scope of the
 * server-function client (a server-only SSE heartbeat constant that should
 * never have reached a client entry), and `@tanstack/solid-router` imports
 * that module statically from `flightData.ts`, which `RouterProvider` pulls in
 * unconditionally on the client. Neither PrimJS (BG) nor Lepus (MT) ships
 * `TextEncoder`, so the import dies before the first frame.
 *
 * Lynx has no server-function runtime, so `pluginSolidLynx` drops the module
 * from the Lynx graph (alias → `packages/plugin/src/server-functions-stub.ts`)
 * instead of filling the host gap with a `TextEncoder` polyfill.
 *
 * This file is the TODO that expires itself: it asserts the leak is STILL
 * there. Once upstream stops leaking, or the router stops importing the
 * module, it fails and names exactly what to delete —
 *
 *   - packages/plugin/src/server-functions-stub.ts
 *   - SERVER_FUNCTIONS_SPECIFIER + its alias in packages/plugin/src/index.ts
 *   - the `loaders/server-functions-stub` entry in
 *     packages/plugin/rslib.config.ts
 *
 * A stubbed export that the router stopped importing needs no test: adding one
 * is invisible, and removing one breaks the build (rspack reports the missing
 * export), which is the louder signal anyway.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

const REMOVE_STUB = [
  '@solidjs/web no longer evaluates TextEncoder at import time (or the router',
  'no longer imports the module) — the Lynx alias is dead weight. Delete:',
  '  packages/plugin/src/server-functions-stub.ts',
  '  SERVER_FUNCTIONS_SPECIFIER + its chain.resolve.alias in packages/plugin/src/index.ts',
  '  the loaders/server-functions-stub entry in packages/plugin/rslib.config.ts',
  'and delete this test with them.',
].join('\n')

function jsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory())
      out.push(...jsFiles(full))
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs'))
      out.push(full)
  }
  return out
}

/**
 * The CLIENT builds of the server-functions subpackage.
 *
 * The server builds are excluded on purpose: they legitimately evaluate
 * `new TextEncoder()` for SSE encoding, so counting them would keep this
 * guard green forever after upstream fixes the client leak — the TODO would
 * never expire.
 */
function serverFunctionClientFiles(): string[] {
  const serverEntry = require.resolve('@solidjs/web/server-functions/server')
  return jsFiles(path.dirname(serverEntry)).filter((file) => {
    const base = path.basename(file)
    return base.startsWith('client') && base.endsWith('.js')
  })
}

/** The router package root, from whatever entry `require` picks. */
function routerFiles(): string[] {
  const entry = require.resolve('@tanstack/solid-router')
  return jsFiles(path.resolve(path.dirname(entry), '../..'))
}

/** A `const X = … new TextEncoder()` starting at column 0, i.e. module scope. */
const IMPORT_TIME_ENCODER = /^const\s+\w+\s*=[\s\S]{0,80}?new\s+TextEncoder\(/m

/** Same pattern as `SPECIFIER_IMPORT`, but without `g` for `.test()`. */
const SPECIFIER_IMPORT_TEST
  = /import\s*\{[^}]+\}\s*from\s*['"]@solidjs\/web\/server-functions['"]/

const SPECIFIER_IMPORT
  = /import\s*\{([^}]+)\}\s*from\s*['"]@solidjs\/web\/server-functions['"]/g

describe('@solidjs/web server-functions leak', () => {
  it('upstream still evaluates TextEncoder at import time', () => {
    const leaked = serverFunctionClientFiles().filter(f => IMPORT_TIME_ENCODER.test(readFileSync(f, 'utf8')))
    expect(leaked, REMOVE_STUB).not.toEqual([])
  })

  it('the router still imports the module statically', () => {
    const importers = routerFiles().filter(f => SPECIFIER_IMPORT_TEST.test(readFileSync(f, 'utf8')))
    expect(importers, REMOVE_STUB).not.toEqual([])
  })

  it('the Lynx stub exports everything the router imports from it', async () => {
    const imported = new Set<string>()
    for (const file of routerFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER_IMPORT)) {
        for (const binding of match[1].split(',')) {
          const name = binding.trim().split(/\s+as\s+/)[0].trim()
          if (name)
            imported.add(name)
        }
      }
    }
    expect(imported.size, 'no static import found — see the test above').toBeGreaterThan(0)

    const stub = await import('../../packages/plugin/src/server-functions-stub')
    for (const name of imported)
      expect(stub, `stub is missing \`${name}\`, which the router imports`).toHaveProperty(name)
  })
})
