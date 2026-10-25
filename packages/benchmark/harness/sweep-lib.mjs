/**
 * Shared helpers for the examples sweeps (offline size scan + device
 * runtime sweep): MIME types for the static dist server, and discovery of
 * built bundles under examples/<name>/dist.
 *
 * MIME lives here rather than in the web harness so the device sweep serves
 * `Content-Length` without pulling in the Lynx-for-Web runner.
 */
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

export const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.map': 'application/json',
  '.bundle': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export function sizeOf(file) {
  const buf = fs.readFileSync(file)
  return { raw: buf.length, gzip: gzipSync(buf).length }
}

/**
 * Walk examples/<name>/dist for *.bundle files.
 *   allLynx  — every .lynx.bundle (what the device opens; device sweep)
 *   webRows  — .web.bundle rows with paired .lynx.bundle (size scan)
 *   lynxOnly — .lynx.bundle without a web pair (size-only rows)
 * `only` optionally restricts to a Set of example names.
 */
export function listBundles(examplesDir, only = null) {
  const webRows = []
  const lynxOnly = []
  const allLynx = []
  if (!fs.existsSync(examplesDir))
    return { webRows, lynxOnly, allLynx }
  for (const d of fs.readdirSync(examplesDir, { withFileTypes: true })) {
    if (!d.isDirectory() || (only && !only.has(d.name)))
      continue
    const dist = path.join(examplesDir, d.name, 'dist')
    if (!fs.existsSync(dist))
      continue
    const files = fs.readdirSync(dist).filter(f => f.endsWith('.bundle'))
    const webs = files.filter(f => f.includes('.web.'))
    const lynxs = files.filter(f => f.includes('.lynx.'))
    for (const l of lynxs)
      allLynx.push({ example: d.name, entry: l, file: path.join(dist, l) })
    for (const w of webs) {
      const pair = w.replace('.web.', '.lynx.')
      webRows.push({
        example: d.name,
        entry: w,
        webFile: path.join(dist, w),
        lynxFile: lynxs.includes(pair) ? path.join(dist, pair) : null,
      })
    }
    for (const l of lynxs) {
      if (!webs.includes(l.replace('.lynx.', '.web.')))
        lynxOnly.push({ example: d.name, entry: l, lynxFile: path.join(dist, l) })
    }
  }
  const key = r => `${r.example}/${r.entry}`
  webRows.sort((a, b) => key(a).localeCompare(key(b)))
  lynxOnly.sort((a, b) => key(a).localeCompare(key(b)))
  allLynx.sort((a, b) => key(a).localeCompare(key(b)))
  return { webRows, lynxOnly, allLynx }
}
