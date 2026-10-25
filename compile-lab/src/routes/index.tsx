import type { SampleInfo } from '../lib/compile'
import { createEffect, createMemo, createSignal, For, onCleanup, onSettled } from 'solid-js'
import Split from 'split.js'
import { BuildPanel } from '../components/BuildPanel'
import { OpsPanel } from '../components/OpsPanel'
import { SourceEditor } from '../components/SourceEditor'
import { compileCode, fetchExample, fetchSamples } from '../lib/compile'
import 'highlight.js/styles/github-dark.css'
import './app.css'

const DEFAULT_SAMPLE = `import { createSignal, Show } from 'solid-js'
import { render } from '@lynx-solid/runtime'

function App() {
  const [count, setCount] = createSignal(0)
  return (
    <view class="card">
      <text>count: {count()}</text>
      <Show when={count() > 0}>
        <text>positive</text>
      </Show>
      <view class="btn" bindtap={() => setCount(count() + 1)}>
        <text>+1</text>
      </view>
    </view>
  )
}

render(() => <App />)
`

// split.js gutter with an explicit cursor: the class names follow the split
// *direction* (gutter-vertical = vertical split = horizontal bar = row-resize),
// so the cursor is set inline instead of relying on class-name-derived CSS.
function createGutter(_i: number, direction: string): HTMLElement {
  const gut = document.createElement('div')
  gut.className = `gutter gutter-${direction}`
  gut.style.cursor = direction === 'vertical' ? 'row-resize' : 'col-resize'
  return gut
}

export default function App() {
  const [code, setCode] = createSignal(DEFAULT_SAMPLE)
  const [css, setCss] = createSignal('')
  const [project, setProject] = createSignal<string | null>(null)
  const [bundleUrl, setBundleUrl] = createSignal('')
  const [buildKey, setBuildKey] = createSignal(0)
  const [buildMs, setBuildMs] = createSignal<number | null>(null)
  const [builtAt, setBuiltAt] = createSignal<number | null>(null)
  const [err, setErr] = createSignal<string | null>(null)
  const [compiling, setCompiling] = createSignal(false)
  let vsplitBox: HTMLDivElement | undefined
  let hsplitBox: HTMLDivElement | undefined
  let editorBox: HTMLElement | undefined
  let stackBox: HTMLElement | undefined
  let stackSplitBox: HTMLDivElement | undefined
  let buildPane: HTMLDivElement | undefined
  let opsPane: HTMLDivElement | undefined
  let splitH: Split.Instance | undefined
  let splitOps: Split.Instance | undefined

  onSettled(() => {
    if (editorBox && stackBox) {
      splitH = Split([editorBox, stackBox], {
        sizes: [45, 55],
        minSize: [240, 260],
        gutterSize: 6,
        direction: 'horizontal',
        cursor: 'col-resize',
        gutter: createGutter,
      })
    }
  })

  onSettled(() => {
    if (stackSplitBox && buildPane && opsPane) {
      splitOps = Split([buildPane, opsPane], {
        sizes: [80, 20],
        minSize: [240, 60],
        gutterSize: 6,
        direction: 'vertical',
        cursor: 'row-resize',
        gutter: createGutter,
      })
    }
  })

  onCleanup(() => {
    splitH?.destroy()
    splitOps?.destroy()
  })

  async function compile(source: string = code(), stylesheet: string = css(), isProject?: string) {
    setErr(null)
    setCompiling(true)
    const start = performance.now()
    try {
      const result = await compileCode(source, stylesheet, isProject ?? project() ?? undefined)
      setBuildMs(Math.round(performance.now() - start))
      setBuiltAt(result.builtAt)
      setBundleUrl(result.bundleUrl)
      setBuildKey(k => k + 1)
    }
    catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBundleUrl('')
    }
    finally {
      setCompiling(false)
    }
  }

  async function loadExample(id: string) {
    setErr(null)
    try {
      // Solid 2 signal writes commit async — read the fetched code directly
      // instead of going through code() right after setCode(), and pass the
      // project flag explicitly for the same reason.
      const sample = await fetchExample(id)
      const isProject = sample.project ? id : undefined
      setProject(isProject ?? null)
      setCode(sample.code)
      setCss(sample.css)
      await compile(sample.code, sample.css, isProject)
    }
    catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const [samples, setSamples] = createSignal<SampleInfo[]>([])

  const GROUP_LABEL: Record<string, string> = {
    lab: 'playground',
    dev: 'dev entries',
    project: 'projects',
  }
  const GROUP_ORDER = ['lab', 'dev', 'project']

  const groupedSamples = createMemo(() => {
    const buckets = new Map<string, SampleInfo[]>()
    for (const s of samples()) {
      const g = s.group ?? (s.project ? 'project' : 'lab')
      const list = buckets.get(g)
      if (list)
        list.push(s)
      else buckets.set(g, [s])
    }
    return GROUP_ORDER.flatMap((g) => {
      const items = buckets.get(g)
      return items && items.length > 0 ? [{ key: g, items }] : []
    })
  })
  createEffect(
    () => null,
    () => {
      fetchSamples().then(setSamples).catch(() => setSamples([]))
    },
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(
    () => code(),
    (c) => {
      clearTimeout(timer)
      timer = setTimeout(() => compile(c), 400)
    },
  )

  onSettled(() => {
    compile()
  })

  return (
    <div class="layout">
      <header class="topbar">
        <h1>compile-lab</h1>
        <span class="dim">Solid on real Lynx (web-core) — rsbuild watch build + lynx-view</span>
        <div class="actions">
          <select
            class="btn sample-select"
            onChange={e => loadExample((e.target as HTMLSelectElement).value)}
          >
            <option value="">— sample —</option>
            <For each={groupedSamples()}>
              {g => (
                <optgroup label={GROUP_LABEL[g.key] ?? g.key}>
                  <For each={g.items}>
                    {s => <option value={s.id}>{s.name}</option>}
                  </For>
                </optgroup>
              )}
            </For>
          </select>
          <button class="btn primary" onClick={() => compile()} disabled={compiling()}>
            {compiling() ? 'building…' : 'compile'}
          </button>
        </div>
      </header>

      <div class="vsplit" ref={vsplitBox}>
        {' '}
        <div class="hsplit" ref={hsplitBox}>
          <section class="panel editor-pane" ref={editorBox}>
            <h3>
              tsx input
              {project() && <span class="dim">· multi-file project (read-only entry)</span>}
            </h3>
            <SourceEditor value={code} onChange={setCode} onCompile={() => compile()} readOnly={() => !!project()} />
          </section>
          <section class="stack" ref={stackBox}>
            <div class="stack-split" ref={stackSplitBox}>
              <div class="split-pane" ref={buildPane}>
                <BuildPanel
                  compiling={compiling}
                  bundleUrl={bundleUrl}
                  buildKey={buildKey}
                  buildMs={buildMs}
                  builtAt={builtAt}
                  code={code}
                  err={err}
                  project={project}
                />
              </div>
              <div class="split-pane" ref={opsPane}>
                <section class="panel ops-card">
                  <OpsPanel />
                </section>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
