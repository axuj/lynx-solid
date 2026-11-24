/**
 * Copy the bundle output into the Android asset folder.
 *
 * `sparkling-app-cli copy-assets` always copies to two destinations — the
 * Android one and an iOS default (`ios/LynxResources/Assets`) — so a project
 * without an iOS shell would grow a stray `ios/` directory on every build. The
 * copy itself is a single `cpSync`, so this example does it here and stays
 * Android-only.
 *
 * `scripts/android.mjs` calls `copyAssets()` directly; run this file to copy
 * after a manual `rspeedy build`:
 *
 *   node scripts/copy-assets.mjs
 */
import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'dist')
const destination = path.join(root, 'android', 'app', 'src', 'main', 'assets')

/** Copy `dist/` over the Android assets; returns the destination. */
export function copyAssets() {
  mkdirSync(destination, { recursive: true })
  cpSync(source, destination, { recursive: true, force: true, dereference: true })
  return destination
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  copyAssets()
  process.stdout.write(`[copy-assets] dist -> ${path.relative(root, destination)}\n`)
}
