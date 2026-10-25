// vite dev middleware serving the rsbuild build output (.build/dist) under
// /dist/* and the @lynx-js/web-core static assets under /static/* (the
// client.js entry references css/wasm relative to its own location).
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Req = IncomingMessage
type Res = ServerResponse
type Next = (err?: unknown) => void

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BUILD_DIST = path.join(ROOT, '.build', 'dist')
// web-core is a root devDependency — one level up from the lab directory.
const WEB_CORE_STATIC = path.resolve(
  ROOT,
  '../node_modules/@lynx-js/web-core/dist/client_prod/static',
)

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.web.bundle': 'application/octet-stream',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

function extOf(p: string): string {
  const base = path.basename(p)
  const i = base.lastIndexOf('.')
  return i < 0 ? '' : base.slice(i)
}

function serveDir(root: string, prefix: string): (req: Req, res: Res) => void {
  return async (req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0]
    const rel = urlPath.slice(prefix.length).replace(/^\/+/, '')
    const target = path.join(root, rel)
    if (!target.startsWith(root)) {
      res.statusCode = 403
      res.end('forbidden')
      return
    }
    try {
      const buf = await readFile(target)
      res.statusCode = 200
      res.setHeader('Content-Type', MIME[extOf(target)] ?? 'application/octet-stream')
      res.end(buf)
    }
    catch {
      res.statusCode = 404
      res.end('not found')
    }
  }
}

export function lynxPreviewMiddleware(): (req: Req, res: Res, next: Next) => void {
  return (req, res, next) => {
    const urlPath = (req.url ?? '/').split('?')[0]
    if (urlPath.startsWith('/dist/')) {
      return serveDir(BUILD_DIST, '/dist/')(req, res)
    }
    if (urlPath.startsWith('/static/')) {
      return serveDir(WEB_CORE_STATIC, '/static/')(req, res)
    }
    next()
  }
}
