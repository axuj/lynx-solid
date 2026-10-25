// rsbuild watch builder for the compile-lab preview.
//
// A module-level singleton: the first /api/compile request spawns a rsbuild
// instance (web environment only) in watch mode. Later requests rewrite the
// dev entry file and wait for the next compile-done event, so incremental
// rebuilds reuse the warm rspack instance. The instance lives for the vite
// dev-server process lifetime.
import type { RsbuildConfig } from '@rsbuild/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { pluginSolidLynx } from '../../../packages/plugin/src/index.ts'
import { devProjectEntryFile, devProjectTarget } from './dev-entries.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BUILD_DIR = path.join(ROOT, '.build')
const ENTRY_FILE = path.join(BUILD_DIR, 'dev', 'src', 'index.tsx')
const BUNDLE_PATH = '/dist/main.web.bundle'

// The lab lives inside the runtime repo: the tree root is the package root.
const SOLID_TREE = path.resolve(ROOT, '..')
const RUNTIME_ENTRY = path.join(SOLID_TREE, 'packages', 'runtime', 'src', 'index.ts')
const MAIN_THREAD_ENTRY = path.join(SOLID_TREE, 'packages', 'runtime', 'src', 'main-thread', 'index.ts')

const WATCH_TIMEOUT_MS = 90_000

let startPromise: Promise<void> | null = null
let lastCode: string | null = null
let waiters: Array<(ok: boolean, err?: string) => void> = []

function notify(ok: boolean, err?: string): void {
  if (!ok) {
    // A failed build resolves all waiters; the next request retries.
    const w = waiters
    waiters = []
    for (const fn of w) fn(false, err)
    return
  }
  const w = waiters
  waiters = []
  for (const fn of w) fn(true)
}

async function ensureBuilder(): Promise<void> {
  if (startPromise)
    return startPromise
  startPromise = (async () => {
    // rsbuild only sets the `.js → .ts` extensionAlias when it finds a
    // tsconfig.json at the project root; without it the runtime's NodeNext
    // style imports ('.js' suffixes on .ts files) fail to resolve.
    mkdirSync(BUILD_DIR, { recursive: true })
    if (!existsSync(path.join(BUILD_DIR, 'tsconfig.json'))) {
      writeFileSync(path.join(BUILD_DIR, 'tsconfig.json'), '{\n  "compilerOptions": {}\n}\n')
    }
    mkdirSync(path.dirname(ENTRY_FILE), { recursive: true })
    // User samples commonly import a stylesheet; an empty index.css keeps
    // those builds resolvable.
    const cssPath = path.join(path.dirname(ENTRY_FILE), 'index.css')
    if (!existsSync(cssPath)) {
      writeFileSync(cssPath, '')
    }
    if (!process.env.LYNX_SOLID_SKIP_ENTRY_SEED) {
      // Seed a compilable entry so the first watch build succeeds even
      // before any user code arrives. Single-param render: the page root is
      // created internally (initBackground rides the bootstrap prepend).
      writeFileSync(
        ENTRY_FILE,
        `import { render } from '@lynx-solid/runtime'
render(() => null)
`,
      )
    }
    const { createRsbuild } = await import('@rsbuild/core')
    // `extensionAlias` / `modules` are rspack resolve options that Rsbuild's
    // `ResolveConfig` type does not surface (the runtime needs them for its
    // NodeNext-style '.js' import suffixes and for the repo-root fallback);
    // keep them typed via the intersection.
    type LabConfig = RsbuildConfig & {
      resolve?: RsbuildConfig['resolve'] & {
        extensionAlias?: Record<string, string[]>
        modules?: string[]
      }
    }
    const cfg: LabConfig = {
      environments: { web: {} },
      source: {
        entry: { main: './dev/src/index.tsx' },
      },
      tools: {
        rspack: {
          cache: false,
          optimization: {
            splitChunks: false,
            runtimeChunk: false,
            sideEffects: false,
          },
          module: {
            rules: [
              {
                test: /\.js$/,
                include: /(signals|solid-js|ultrahtml)/,
                use: [{ loader: 'builtin:swc-loader', options: { jsc: { target: 'es2017' } } }],
              },
            ],
          },
        },
      },
      resolve: {
        alias: {
          // The fork dom pipeline emits imports against the lynx-template
          // runtime; longer alias keys must come first so rspack's prefix
          // matching hits the subpath instead of the bare '@lynx-solid/runtime'.
          '@lynx-solid/runtime/lynx-template': path.join(SOLID_TREE, 'packages', 'runtime', 'src', 'background', 'lynx-template.ts'),
          '@lynx-solid/runtime': RUNTIME_ENTRY,
          // The dev entry lives in .build/ while the runtime sources resolve
          // from the repo root — without aliases the two copies of solid-js
          // (and @solidjs/signals) split the reactive graph: effects no
          // longer observe signals created by user code. Pin everything
          // to the copy this repo resolves.
          // Pin the client build of solid-js: rspack resolves this bundle
          // with the "worker" export condition, which maps solid-js to its
          // server build (no reactivity — signals never notify effects).
          'solid-js': path.join(SOLID_TREE, 'node_modules', 'solid-js', 'dist', 'solid.js'),
          '@solidjs/signals': path.join(SOLID_TREE, 'node_modules', '@solidjs', 'signals'),
          // Deps used by multi-file dev projects (elk) — keep build parity
          // with rsbuild.config.ts (whatever dev can resolve, this must resolve too; whatever dev cannot, neither can this).
          'masto': path.join(SOLID_TREE, 'node_modules', 'masto'),
          'ultrahtml': path.join(SOLID_TREE, 'node_modules', 'ultrahtml'),
          '@lynx-js/types': path.join(SOLID_TREE, 'node_modules', '@lynx-js', 'types'),
          // change-case@5 (transitive dep of masto) uses Unicode property
          // escapes PrimJS cannot parse — same ASCII adapter as rsbuild.config.ts.
          'change-case': path.join(SOLID_TREE, 'examples', 'elk', 'src', 'composables', 'change-case.ts'),
        },
        // The runtime sources import each other with `.js` suffixes
        // (NodeNext style); map them onto the actual `.ts` files.
        extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
        // Multi-file dev projects (elk) import deps from the repo's
        // node_modules (masto, ultrahtml, @lynx-js/types);
        // let resolution fall back to that repo's node_modules.
        modules: ['node_modules', path.join(SOLID_TREE, 'node_modules')],
      },
      plugins: [
        pluginSolidLynx({ mainThreadEntry: MAIN_THREAD_ENTRY }),
      ],
    }
    const rsbuild = await createRsbuild({
      cwd: BUILD_DIR,
      callerName: 'rsbuild',
      loadEnv: false,
      environment: ['web'],
      rsbuildConfig: cfg,
    })

    rsbuild.onAfterBuild(({ stats }) => {
      const ok = !stats?.hasErrors()
      console.log(`[rsbuild] build done: ${ok ? 'ok' : 'FAILED'}`)
      if (ok)
        notify(true)
      else notify(false, stats?.toString({}))
    })
    // watch mode: the promise stays pending; completion arrives via
    // onAfterBuild.
    console.log('[rsbuild] starting watch build')
    void rsbuild.build({ watch: true }).catch((e: unknown) => {
      // A failed incremental build rejects the promise; keep the watch
      // loop alive (unhandled rejections would kill the vite process).
      console.error('[rsbuild] watch build rejected:', String(e).slice(0, 200))
    })
  })()
  return startPromise
}

/**
 * Rewrite the dev entry for compilation: drop the legacy preview idiom's
 * second render arg — `render(X, 'root')` / `render(X, createPageRoot())`
 * onto the current single-param API (the page root is created internally,
 * initBackground rides the plugin-prepended bootstrap).
 */
export function rewriteEntrySource(code: string): string {
  return code.replace(
    /render\(([^;]*?),\s*(?:['"][^'"]+['"]|createPageRoot\(\))\s*\)/g,
    'render($1)',
  )
}

/**
 * Rewrite the dev entry and wait for the watch build to finish.
 * Resolves with the bundle URL (served by the vite middleware).
 * The optional css mirrors the entry's `import './index.css'` so the build
 * carries the sample's real stylesheet instead of the empty placeholder.
 * When `project` is given the entry becomes an absolute import of the real
 * dev project file — no copy: relative imports (./components, ./elk.css)
 * resolve in place, and IDE edits to the demo rebuild live through the
 * watch. (The plugin pipeline is location-agnostic: skeleton targets key on
 * the resolved absolute path and the worklet loader matches /src/.)
 */
export async function requestBuild(
  code: string,
  css?: string,
  project?: string,
): Promise<{ bundleUrl: string, builtAt: number }> {
  await ensureBuilder()
  // Project ids (dev/<name>) resolve through discovery — an unknown id
  // throws instead of feeding a path (compile.ts pre-validates for a 400).
  const target = project ? devProjectTarget(project) : null
  if (project && !target)
    throw new Error(`unknown project: ${project}`)
  let rewritten: string
  if (target) {
    const entryFile = devProjectEntryFile(target.dir)
    if (!entryFile)
      throw new Error(`project has no index entry: ${project}`)
    // Absolute specifier, posix slashes — rspack resolves it directly.
    rewritten = `import ${JSON.stringify(entryFile.split(path.sep).join('/'))}\n`
  }
  else {
    rewritten = rewriteEntrySource(code)
  }
  const key = target
    ? JSON.stringify({ project })
    : css ? JSON.stringify({ code: rewritten, css }) : rewritten
  if (key === lastCode) {
    return { bundleUrl: BUNDLE_PATH, builtAt: Date.now() }
  }
  lastCode = key
  mkdirSync(path.dirname(ENTRY_FILE), { recursive: true })
  if (css) {
    const cssPath = path.join(path.dirname(ENTRY_FILE), 'index.css')
    if (!existsSync(cssPath) || readFileSync(cssPath, 'utf8') !== css) {
      writeFileSync(cssPath, css)
    }
  }
  writeFileSync(ENTRY_FILE, rewritten)
  return new Promise((resolve, reject) => {
    // Mutual reference (settle clears the timer, the timer drops settle),
    // so one of them must be a let declared up front.
    let timer: ReturnType<typeof setTimeout>
    const settle = (ok: boolean, err?: string): void => {
      clearTimeout(timer)
      if (ok)
        resolve({ bundleUrl: BUNDLE_PATH, builtAt: Date.now() })
      else reject(new Error(err ?? 'build failed'))
    }
    timer = setTimeout(() => {
      const i = waiters.indexOf(settle)
      if (i >= 0)
        waiters.splice(i, 1)
      reject(new Error(`build timeout after ${WATCH_TIMEOUT_MS}ms`))
    }, WATCH_TIMEOUT_MS)
    waiters.push(settle)
  })
}
