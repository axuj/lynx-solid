import type { APIHandler } from 'filesystem-routing/api'
// Built-in sample scenes: the curated playground set below plus everything
// discovered under dev/src (see ../../server/dev-entries — new demos appear
// automatically, no edits needed here). Each entry maps an id to a code file
// (and an optional stylesheet). The entry is compiled inside .build/dev/src/,
// so a stylesheet must ride along with the code (mirrors how the compiler
// treats a user-submitted { code, css } pair).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { discoverDevEntries } from '../../server/dev-entries'

export type SampleGroup = 'lab' | 'dev' | 'project'

interface SampleDef {
  name: string
  code: string
  css?: string
  project?: boolean
  group: SampleGroup
}

const SAMPLES: Record<string, SampleDef> = {
  'counter': {
    name: 'counter (createSignal + Show)',
    code: fileURLToPath(new URL('../../../samples/counter.tsx', import.meta.url)),
    group: 'lab',
  },
  'list-1000': {
    name: '1000-row keyed list',
    code: fileURLToPath(new URL('../../../samples/list-1000.tsx', import.meta.url)),
    css: fileURLToPath(new URL('../../../samples/list-1000.css', import.meta.url)),
    group: 'lab',
  },
  'mt-draggable': {
    name: 'main-thread draggable',
    code: fileURLToPath(new URL('../../../samples/mt-draggable.tsx', import.meta.url)),
    group: 'lab',
  },
  'scroll-list': {
    name: 'scroll list (For + bindtap)',
    code: fileURLToPath(new URL('../../../samples/scroll-list.tsx', import.meta.url)),
    group: 'lab',
  },
  'async-memo': {
    name: 'async memo + Loading',
    code: fileURLToPath(new URL('../../../samples/async-memo.tsx', import.meta.url)),
    group: 'lab',
  },
}

function allSamples(): Record<string, SampleDef> {
  const map: Record<string, SampleDef> = { ...SAMPLES }
  for (const e of discoverDevEntries()) {
    if (e.kind === 'project') {
      map[e.id] = { name: e.name, code: e.codePath, project: true, group: 'project' }
    }
    else {
      const def: SampleDef = { name: e.name, code: e.codePath, group: 'dev' }
      if (e.cssPath)
        def.css = e.cssPath
      map[e.id] = def
    }
  }
  return map
}

export const GET: APIHandler = (event) => {
  const url = new URL(event.request.url)
  const id = url.searchParams.get('id')
  const samples = allSamples()
  if (id) {
    const sample = samples[id]
    if (!sample) {
      return Response.json({ ok: false, error: `unknown sample: ${id}` }, { status: 404 })
    }
    return Response.json({
      ok: true,
      code: readFileSync(sample.code, 'utf8'),
      css: sample.css ? readFileSync(sample.css, 'utf8') : '',
      project: sample.project ?? false,
    })
  }
  return Response.json({
    ok: true,
    samples: Object.entries(samples).map(([id, s]) => ({
      id,
      name: s.name,
      project: s.project ?? false,
      group: s.group,
    })),
  })
}
