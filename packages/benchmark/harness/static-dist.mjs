import fs from 'node:fs'
// Static server for the PRODUCTION build, so device runs are never served a
// dev bundle. The dev server's own build fails on module resolution, and a
// failed dev build leaves the previously emitted bundle in place — which is how
// a device run once "passed" against a build that had never compiled.
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'

const ROOT = 'dist'
const PORT = Number(process.argv[2] ?? 4300)
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.map': 'application/json' }

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const file = path.join(ROOT, path.basename(url.pathname))
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('not found')
      return
    }
    // CACHEABLE on purpose. Without this every rep re-downloads the bundle and
    // the IFR build (213K) pays ~70% more transfer than the non-IFR one (127K) —
    // which is a measurement artifact, not an IFR cost: a shipped app's bundle
    // is local. The harness appends a content hash to the URL, so the cache is
    // per-build and a rebuild can never serve a stale bundle.
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    })
    res.end(fs.readFileSync(file))
  })
  .listen(PORT, '0.0.0.0', () => console.log(`[static] ${ROOT} on http://0.0.0.0:${PORT}/main.lynx.bundle`))
