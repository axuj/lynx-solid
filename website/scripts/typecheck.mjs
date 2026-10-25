/**
 * Cross-platform typecheck gate for the docs site (node >= 18, no grep).
 *
 * Runs `tsc --noEmit` and reports only errors in OUR files. Errors inside
 * `node_modules` (today: `@lynx-js/go-web` ships raw `.tsx` as its types,
 * so tsc checks the library's own sources as part of our program — nothing
 * a consumer config can silence) are counted and suppressed instead of
 * failing the gate. tsc itself has no "ignore node_modules" switch:
 * `exclude` doesn't cover imported files and `skipLibCheck` covers only
 * `.d.ts`, so filtering the output is the only option short of narrowing
 * `include` (which would blind tsc to our own `src/`).
 *
 * `--pretty false` keeps every diagnostic on one line so the
 * `node_modules` path test is reliable across Windows/posix separators.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const websiteRoot = path.resolve(__dirname, '..')

const require = createRequire(path.join(websiteRoot, 'package.json'))
const tscBin = require.resolve('typescript/bin/tsc')

const result = spawnSync(
  process.execPath,
  [tscBin, '--noEmit', '-p', './tsconfig.json', '--pretty', 'false'],
  { cwd: websiteRoot, encoding: 'utf8' },
)

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
const lines = output.split(/\r?\n/).filter(line => line.length > 0)
const ownErrors = lines.filter(
  line => line.includes('error TS') && !line.includes('node_modules'),
)
const suppressed = lines.filter(
  line => line.includes('error TS') && line.includes('node_modules'),
)

for (const line of ownErrors) {
  console.log(line)
}

if (result.error) {
  console.error(`typecheck: failed to run tsc: ${result.error.message}`)
  process.exit(2)
}

if (ownErrors.length > 0) {
  console.error(
    `typecheck: ${ownErrors.length} error(s) in project files `
    + `(${suppressed.length} suppressed in node_modules)`,
  )
  process.exit(1)
}

console.log(
  `typecheck: clean in project files (${suppressed.length} error(s) suppressed in node_modules)`,
)
