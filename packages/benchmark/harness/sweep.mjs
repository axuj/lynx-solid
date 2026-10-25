/**
 * Examples breadth sweep — offline bundle-size catalog (the breadth axis to
 * the cross bench's depth axis, reference format: vue-lynx-vapor's
 * examples-sweep report).
 *
 * For EVERY entry under examples/<name>/dist:
 *   - .lynx.bundle raw/gzip — the shipped artifact (device delivery size)
 *   - paired .web.bundle raw/gzip — dev/docs-preview cost
 * No browser, no runtime: deterministic and CI-friendly. Runtime breadth
 * (real-device open → first frame) lives in sweep-device.mjs.
 *
 * Usage: node harness/sweep.mjs [--only a,b]
 * Output: results/examples-sweep.json + results/examples-sweep.md
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { listBundles, sizeOf } from './sweep-lib.mjs'

const harnessDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(harnessDir, '../../..')
const resultsDir = path.join(root, 'packages/benchmark/results')
const examplesDir = path.join(root, 'examples')

const { values: args } = parseArgs({
  options: {
    only: { type: 'string', default: '' },
  },
})
const ONLY = args.only
  ? new Set(args.only.split(',').map(s => s.trim()).filter(Boolean))
  : null

function main() {
  const { webRows, lynxOnly } = listBundles(examplesDir, ONLY)
  if (webRows.length === 0 && lynxOnly.length === 0) {
    console.error('[sweep] no examples with dist found')
    process.exit(1)
  }

  const rows = webRows.map((row) => {
    const webSize = sizeOf(row.webFile)
    const lynxSize = row.lynxFile ? sizeOf(row.lynxFile) : null
    const entry = {
      example: row.example,
      entry: row.entry,
      webRaw: webSize.raw,
      webGzip: webSize.gzip,
      lynxRaw: lynxSize?.raw ?? null,
      lynxGzip: lynxSize?.gzip ?? null,
    }
    console.log(
      `[sweep] ${entry.example}/${entry.entry} web=${(entry.webGzip / 1024).toFixed(1)}Kgzip`
      + ` lynx=${entry.lynxGzip == null ? '—' : `${(entry.lynxGzip / 1024).toFixed(1)}Kgzip`}`,
    )
    return entry
  })

  const result = {
    meta: {
      date: new Date().toISOString(),
      node: process.version,
      method: 'offline static scan of built dist (no browser, no runtime) — lynx bundle = shipped artifact; web bundle = dev/docs-preview cost',
    },
    rows,
    lynxOnly: lynxOnly.map(l => ({ example: l.example, entry: l.entry, ...sizeOf(l.lynxFile) })),
  }
  fs.mkdirSync(resultsDir, { recursive: true })
  fs.writeFileSync(path.join(resultsDir, 'examples-sweep.json'), `${JSON.stringify(result, null, 2)}\n`)

  let md = `# Examples sweep — bundle size (breadth axis)\n\n`
  md += `- date: ${result.meta.date}\n- node: ${result.meta.node}\n`
  md += `- method: ${result.meta.method}\n`
  md += `- related: real-device runtime breadth in examples-sweep-device.md; reference format: vue-lynx-vapor examples-sweep\n\n`
  md += `| example | entry | web raw | web gzip | lynx raw | lynx gzip |\n`
  md += `|---|---|---|---|---|---|\n`
  for (const r of rows) {
    md += `| ${r.example} | ${r.entry} | ${r.webRaw} | ${r.webGzip}`
      + ` | ${r.lynxRaw ?? '—'} | ${r.lynxGzip ?? '—'} |\n`
  }
  if (result.lynxOnly.length > 0) {
    md += `\n## Lynx-only bundles (no web entry — size only)\n\n`
    md += `| example | entry | raw | gzip |\n|---|---|---|---|\n`
    for (const l of result.lynxOnly)
      md += `| ${l.example} | ${l.entry} | ${l.raw} | ${l.gzip} |\n`
  }
  fs.writeFileSync(path.join(resultsDir, 'examples-sweep.md'), md)
  console.log(`[sweep] wrote results/examples-sweep.{json,md} (${rows.length} entries)`)
}

main()
