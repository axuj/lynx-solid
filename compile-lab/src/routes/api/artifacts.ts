import type { APIHandler } from 'filesystem-routing/api'
// Artifacts endpoint: compiles the user source through the same single-pass
// pipeline the rsbuild build uses (fork babel-plugin-jsx-lynx) and returns
// the readable BG module code and the MT skeleton module (registerSkeleton
// calls with createCode literals), so the inspector shows what the compiler
// produced instead of the webpack bundle.
// Both sources are also written to .build/inspect/ for on-disk inspection.
// Note: the rsbuild build path (build-watch.ts) imports the plugin/runtime
// as repo-relative sources, so the inspector uses the same in-repo imports
// to stay in sync with what the build actually compiles.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileDomModule } from '../../../../packages/compiler/src/dom-compile'
import { renderSkeletonModuleLynx } from '../../../../packages/plugin/src/skeleton-loader'
import { rewriteEntrySource } from '../../server/build-watch'
import { formatSkeletonModule } from '../../server/skeleton-format'

const MAX_BODY = 1_000_000

// The plugin writes the MT skeleton import as a relative path from the
// main-thread entry directory; mirror that so the panel output matches the
// real build artifact.
const SKELETON_REGISTRY = './skeleton-registry'

const INSPECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.build/inspect')

interface ArtifactsRequest {
  code?: string
}

export const POST: APIHandler = async ({ request }) => {
  const raw = await request.text()
  if (raw.length > MAX_BODY) {
    return Response.json({ ok: false, error: 'body too large (max 1MB)' }, { status: 413 })
  }
  let req: ArtifactsRequest
  try {
    req = JSON.parse(raw)
  }
  catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  try {
    const rewritten = rewriteEntrySource(String(req.code ?? ''))
    const compiled = compileDomModule(rewritten, { filename: 'index.tsx' })
    const bgSource = compiled.code
    const mtSkeleton = formatSkeletonModule(
      renderSkeletonModuleLynx(compiled.templates, SKELETON_REGISTRY),
    )
    mkdirSync(INSPECT_DIR, { recursive: true })
    writeFileSync(path.join(INSPECT_DIR, 'bg-source.js'), bgSource)
    writeFileSync(path.join(INSPECT_DIR, 'mt-skeleton.js'), mtSkeleton)
    return Response.json({
      ok: true,
      bgSource,
      mtSkeleton,
      bgPath: path.join(INSPECT_DIR, 'bg-source.js'),
      mtPath: path.join(INSPECT_DIR, 'mt-skeleton.js'),
      templateCount: compiled.templates.length,
    })
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: message }, { status: 422 })
  }
}
