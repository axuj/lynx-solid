import type { APIHandler } from 'filesystem-routing/api'
// Compile endpoint: writes the user source as the dev entry and waits for
// the resident rsbuild watch build (web environment) to finish. The bundle
// URL is served by the /dist/* middleware.
import { requestBuild } from '../../server/build-watch'
import { devProjectTarget } from '../../server/dev-entries'

const MAX_BODY = 1_000_000

// Multi-file dev projects are discovered under examples/*/src (see
// server/dev-entries) — the name feeds a path, so unknown ids (including
// traversal attempts) are rejected here, never resolved.

interface CompileRequest {
  code?: string
  css?: string
  filename?: string
  mode?: string
  project?: string
}

/**
 * Rspack failure messages carry ANSI codes, the failing source excerpt and
 * a long internal stack. Editing is incremental — the editor compiles on
 * every debounced change — so a syntax slip mid-edit should produce a short
 * one-line hint, not a wall of text.
 */
function summarizeBuildError(message: string): string {
  // ANSI CSI escape strip (SGR color codes from rspack output).
  // eslint-disable-next-line no-control-regex
  const clean = message.replace(/\u001B\[[0-9;]*m/g, '')
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean)
  const start = lines.findIndex(l =>
    /SyntaxError|ParseError|Module build failed|Module not found|Can't resolve/.test(l),
  )
  if (start < 0)
    return clean.slice(0, 400)
  const excerpt: string[] = []
  for (const line of lines.slice(start)) {
    if (line.startsWith('at ') || line.startsWith('(at '))
      break
    excerpt.push(line)
    if (excerpt.length >= 12)
      break
  }
  return excerpt.join('\n')
}

export const POST: APIHandler = async ({ request }) => {
  const raw = await request.text()
  if (raw.length > MAX_BODY) {
    return Response.json({ ok: false, error: 'body too large (max 1MB)' }, { status: 413 })
  }
  let req: CompileRequest
  try {
    req = JSON.parse(raw)
  }
  catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  try {
    const project = req.project
    // The id feeds a path (see requestBuild) — fixed allowlist, never
    // resolved blindly.
    if (project && !devProjectTarget(project)) {
      return Response.json({ ok: false, error: `unknown project: ${project}` }, { status: 400 })
    }
    const result = await requestBuild(String(req.code ?? ''), req.css, project)
    return Response.json({ ok: true, ...result })
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: summarizeBuildError(message) }, { status: 422 })
  }
}
