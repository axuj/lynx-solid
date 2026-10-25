import hljs from 'highlight.js/lib/common'
import { createMemo, createSignal, Loading, Show } from 'solid-js'
import { LynxPreview } from './LynxPreview'

type Tab = 'preview' | 'build' | 'bg' | 'mt' | 'manifest'

const ARTIFACTS: Record<Exclude<Tab, 'build' | 'preview'>, { file: string, label: string }> = {
  bg: { file: 'background.js', label: 'BG bundle' },
  mt: { file: 'main-thread.js', label: 'MT skeleton' },
  manifest: { file: 'tasm.json', label: 'manifest' },
}

interface GeneratedArtifacts {
  bgSource: string
  mtSkeleton: string
}

async function fetchGenerated(code: string): Promise<GeneratedArtifacts> {
  const res = await fetch('/api/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok)
    throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

async function fetchRaw(file: string): Promise<string> {
  const res = await fetch(`/dist/main/${file}`)
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export function BuildPanel(props: {
  compiling: () => boolean
  bundleUrl: () => string
  buildKey: () => number
  buildMs: () => number | null
  builtAt: () => number | null
  code: () => string
  err: () => string | null
  project: () => string | null
}) {
  const [tab, setTab] = createSignal<Tab>('preview')
  const [raw, setRaw] = createSignal(false)

  const artifact = createMemo(async () => {
    try {
      const t = tab()
      if (t === 'preview' || t === 'build')
        return undefined
      // Multi-file projects have no single-buffer two-pass source; only the
      // real webpack output exists — fall back to raw unconditionally.
      // Props are read before the first await so tracking stays intact.
      const useRaw = props.project() || raw() || t === 'manifest'
      const code = props.code()
      if (t === 'bg' && !useRaw) {
        return { text: (await fetchGenerated(code)).bgSource }
      }
      if (t === 'mt' && !useRaw) {
        return { text: (await fetchGenerated(code)).mtSkeleton }
      }
      return { text: await fetchRaw(ARTIFACTS[t].file) }
    }
    catch (e) {
      // A syntax error in the in-progress editor code rejects the compile;
      // surface it in the panel instead of letting the async memo reject
      // into Solid's global error overlay.
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  const artifactHtml = createMemo(() => {
    const a = artifact()
    if (a === undefined)
      return undefined
    if (a.error !== undefined) {
      return a.error.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
    return hljs.highlight(a.text!, { language: tab() === 'manifest' ? 'json' : 'javascript' }).value
  })

  const title = () => {
    const t = tab()
    if (t === 'build' || t === 'preview')
      return ''
    if (t === 'bg')
      return props.project() || raw() ? 'BG thread bundle — raw webpack output' : 'BG thread bundle — two-pass compiled source'
    if (t === 'mt')
      return props.project() || raw() ? 'MT skeleton entry — raw webpack output' : 'MT skeleton — registerSkeleton + createCode literals'
    return 'template manifest'
  }

  const fmtTime = (t: number | null) =>
    t ? `${new Date(t).toLocaleTimeString('en-GB', { hour12: false })}.${String(t % 1000).padStart(3, '0')}` : '-'

  return (
    <section class="panel">
      <div class="tabs">
        <button class={`tab${tab() === 'preview' ? ' active' : ''}`} onClick={() => setTab('preview')}>
          preview
        </button>
        <button class={`tab${tab() === 'build' ? ' active' : ''}`} onClick={() => setTab('build')}>
          build
        </button>
        <Show when={props.bundleUrl()}>
          <button class={`tab${tab() === 'bg' ? ' active' : ''}`} onClick={() => setTab('bg')}>
            BG
          </button>
          <button class={`tab${tab() === 'mt' ? ' active' : ''}`} onClick={() => setTab('mt')}>
            MT
          </button>
          <button class={`tab${tab() === 'manifest' ? ' active' : ''}`} onClick={() => setTab('manifest')}>
            manifest
          </button>
        </Show>
      </div>

      <Show
        when={tab() === 'build'}
        fallback={
          tab() === 'preview'
            ? (
                <div class="preview-body">
                  <LynxPreview url={props.bundleUrl} key={props.buildKey} />
                  <Show when={props.err()}>
                    <div class="preview-error">{props.err()}</div>
                  </Show>
                </div>
              )
            : (
                <div class="artifact-view">
                  <div class="artifact-head">
                    <span class="dim">
                      {title()}
                      {' '}
                      —
                      <code>
                        /dist/main/
                        {ARTIFACTS[tab() as Exclude<Tab, 'build' | 'preview'>].file}
                      </code>
                    </span>
                    <span class="artifact-actions">
                      <Show when={(tab() === 'bg' || tab() === 'mt') && !props.project()}>
                        <button class={`tab${raw() ? ' active' : ''}`} onClick={() => setRaw(!raw())}>
                          raw
                        </button>
                      </Show>
                      <a
                        class="tab"
                        href={`/dist/main/${ARTIFACTS[tab() as Exclude<Tab, 'build' | 'preview'>].file}`}
                        target="_blank"
                      >
                        open
                      </a>
                    </span>
                  </div>
                  <Loading fallback={<div class="dim">loading…</div>}>
                    <pre class="artifact-pre">
                      {/* highlight.js escapes code HTML; the error branch above escapes manually */}
                      {/* eslint-disable-next-line solid/no-innerhtml */}
                      <code class="hljs" innerHTML={artifactHtml()} />
                    </pre>
                  </Loading>
                </div>
              )
        }
      >
        <h3>
          build
          {' '}
          <span class="dim">(rsbuild watch · web env)</span>
        </h3>
        <ul class="build-info">
          <li>
            status:
            {' '}
            {props.compiling() ? 'building…' : props.bundleUrl() ? 'ready' : 'idle'}
          </li>
          <li>
            bundle:
            {' '}
            <Show when={props.bundleUrl()} fallback="—">
              <code>{props.bundleUrl()}</code>
            </Show>
          </li>
          <li>
            last build:
            {props.buildMs() !== null ? `${props.buildMs()}ms` : '—'}
          </li>
          <li>
            built at:
            {fmtTime(props.builtAt())}
          </li>
        </ul>
        <p class="dim hint">
          Output is the official
          {' '}
          <code>.web.bundle</code>
          {' '}
          (lepusCode = MT, manifest = BG),
          loaded by
          {' '}
          <code>&lt;lynx-view&gt;</code>
          {' '}
          from @lynx-js/web-core.
        </p>
      </Show>
    </section>
  )
}
