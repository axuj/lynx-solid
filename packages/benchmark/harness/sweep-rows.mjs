/**
 * Row-count sweep: where does MT-IFR stop winning — and where does ReactLynx win?
 *
 * A **thin orchestrator over `ab-device.mjs`** — it owns no launch, no logcat
 * parsing and no verdict. It only (a) builds the arms once per row count,
 * (b) runs `ab-device.mjs --json` in the same window for each row count, and
 * (c) aggregates and fits the result. Every number it prints is the driver's
 * own, so the sweep can never disagree with a single-point run.
 *
 * Three arms, all measured inside the SAME window (one rep of A, B, C,
 * repeating), so every pairwise Δ is same-window and the medians stay
 * comparable:
 *
 *   A  our-default  `examples/bench-table`        IFR off
 *   B  our-ifr      `examples/bench-table`        `enableMtIfr: true`
 *   C  react        `examples/bench-table-react`  ReactLynx (`--react`)
 *
 * C is optional because it is a different app: it has to be built from its own
 * example, and it is the control that says whether our arm's shape is a property
 * of the feature or of the app.
 *
 * Why it has to build per point: the row count is baked into the bundle
 * (`src/rows-config.ts` of each example), and the IFR switch is a plugin option
 * (`rsbuild.config.ts`). The bundle size does not change with the row count (the
 * data is generated at runtime), so the sweep has no size confound.
 *
 * `rsbuild build` clears `dist/`, so the arms are built into a stash
 * (`examples/bench-table/node_modules/.cache/lynx-solid-sweep/`), published into
 * `examples/bench-table/dist/` for the measurement phase, and republished after
 * the final pristine rebuild. Result: `dist/main.lynx.bundle` is always the
 * canonical demo bundle (never a sweep arm), and every `def-<rows>` /
 * `ifr-<rows>` / `react-<rows>` triple stays in the served directory so the arms
 * of a point can be compared pixel by pixel afterwards (`adb exec-out screencap`,
 * see the docs).
 *
 * Usage:
 *   node sweep-rows.mjs --serial 192.168.3.148:5555 --url http://192.168.3.91:8403 \
 *     [--react] [--rows 0,25,50,75,100,250,500,1000] [--reps 11] [--skip-build]
 *     [--gap <ms>] [--tag=<suffix>] [--fit-max 500]
 *
 * Prints exactly the table the docs publish, so "the numbers came from this
 * command" is checkable. `--tag` exists because the rig knobs above are
 * per-RUN, not per-arm: comparing two of them means two runs at one row count,
 * and without a tag the second run would overwrite the first run's JSON.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const DEMO = path.join(ROOT, 'examples/bench-table')
const REACT_DEMO = path.join(ROOT, 'examples/bench-table-react')
const DIST = path.join(DEMO, 'dist')
const STASH = path.join(DEMO, 'node_modules/.cache/lynx-solid-sweep')
const ROWS_CONFIG = path.join(DEMO, 'src/rows-config.ts')
const LYNX_CONFIG = path.join(DEMO, 'rsbuild.config.ts')
const REACT_ROWS_CONFIG = path.join(REACT_DEMO, 'src/rows-config.ts')
const DRIVER = path.join(import.meta.dirname, 'ab-device.mjs')
const MANIFEST = path.join(STASH, 'manifest.json')
// Everything whose bytes can change an arm bundle. Both `src` and `dist` of the
// workspace packages are hashed on purpose: if `src` moved but `dist` was not
// rebuilt, the fingerprint changes and `--skip-build` refuses to reuse — it
// cannot know whether the stale dist was the one measured. (The script does not
// rebuild the packages itself; `nub run -F <pkg> build` stays explicit.)
const FINGERPRINT_DIRS = [
  path.join(ROOT, 'examples/bench-table/src'),
  path.join(ROOT, 'examples/bench-table-react/src'),
  path.join(ROOT, 'packages/plugin/src'),
  path.join(ROOT, 'packages/plugin/dist'),
  path.join(ROOT, 'packages/runtime/src'),
  path.join(ROOT, 'packages/runtime/dist'),
]
const FINGERPRINT_FILES = [
  LYNX_CONFIG,
  path.join(REACT_DEMO, 'rsbuild.config.ts'),
]

const USAGE = `usage: sweep-rows.mjs --serial <device:port> --url <static base> [options]
  --rows 0,25,50,75,100,250,500,1000   row counts, one window each
  --reps 11                            interleaved reps per arm per window
  --react                              add the ReactLynx arm as a third side
  --skip-build                         reuse stashed arms, but only ones the
                                       manifest proves current (fingerprint +
                                       bundle sha256); anything else is rebuilt
  --gap <ms|n>                         quiet time between launches (default 0)
  --tag=<suffix>                       suffix for the JSON/label of this run
  --fit-max 500                        fit range for the crossover numbers (the
                                       500-1000 segment is not linear)`

let parsed

try {
  parsed = parseArgs({
    options: {
      'serial': { type: 'string', default: '' },
      'url': { type: 'string', default: '' },
      'rows': { type: 'string', default: '0,25,50,75,100,250,500,1000' },
      'reps': { type: 'string', default: '11' },
      'react': { type: 'boolean', default: false },
      // Distinguishes runs of the SAME row count under different rig knobs, so one
      // run's JSON does not overwrite another's.
      'tag': { type: 'string', default: '' },
      // Fit range for the crossover numbers. The 500-1000 segment is not linear on
      // any arm, so folding it in pushes every intercept below the measured 0-row
      // value and moves the react-vs-ifr crossover by ~40 rows.
      'fit-max': { type: 'string', default: '500' },
      // Rig knob, passed straight through to the driver (per-run, not per-arm, so
      // comparing values means two runs at the same row count).
      'gap': { type: 'string', default: '' },
      'retries': { type: 'string', default: '' },
      'rebuild-pristine': { type: 'boolean', default: true },
      'skip-build': { type: 'boolean', default: false },
    },
  })
}
catch (err) {
  // `parseArgs` throws a raw TypeError for a typo'd flag; a stack trace is not a
  // useful answer to "what does this script take?".
  console.error(`${err.message}\n\n${USAGE}`)
  process.exit(1)
}

const { values: a } = parsed

if (!a.serial || !a.url) {
  console.error('need --serial and --url (the static server base for the demo dist)')
  process.exit(1)
}

const OFF = 'pluginSolidLynx()'
const ON = 'pluginSolidLynx({ enableMtIfr: true })'
const rowsList = a.rows.split(',').map(Number)
const names = rowsList.flatMap(n => (a.react ? [`def-${n}`, `ifr-${n}`, `react-${n}`] : [`def-${n}`, `ifr-${n}`]))

function sh(cmd, args, cwd, { quiet = false, inherit = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 900_000,
    maxBuffer: 256 * 1024 * 1024,
    ...(inherit ? { stdio: 'inherit' } : {}),
  })
  if (inherit) {
    if (r.status !== 0)
      throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`)
    return ''
  }
  if (!quiet && r.stdout)
    process.stdout.write(r.stdout)
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.join(' ')} failed\n${(r.stdout ?? '') + (r.stderr ?? '')}`)
  return `${r.stdout ?? ''}${r.stderr ?? ''}`
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir))
    return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory())
      walkFiles(p, out)
    else if (entry.isFile())
      out.push(p)
  }
  return out
}

function fingerprint() {
  const h = createHash('sha256')
  const files = [
    ...FINGERPRINT_DIRS.flatMap(d => walkFiles(d)),
    ...FINGERPRINT_FILES.filter(f => fs.existsSync(f)),
  ].sort()
  for (const file of files) {
    h.update(path.relative(ROOT, file).split(path.sep).join('/'))
    h.update('\u0000')
    h.update(fs.readFileSync(file))
    h.update('\u0000')
  }
  return h.digest('hex').slice(0, 16)
}

function gitState() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const head = r.status === 0 ? r.stdout.trim() : 'no-git'
  const s = spawnSync('git', ['status', '--porcelain'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  return `${head}${s.status === 0 && s.stdout.trim() ? '+dirty' : ''}`
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  }
  catch {
    return {}
  }
}

function writeManifest(m) {
  fs.writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`)
}

const originalRows = fs.readFileSync(ROWS_CONFIG, 'utf8')
const originalLynx = fs.readFileSync(LYNX_CONFIG, 'utf8')
const originalReactRows = a.react ? fs.readFileSync(REACT_ROWS_CONFIG, 'utf8') : null
if (!originalLynx.includes(OFF)) {
  console.error(`could not find \`${OFF}\` in rsbuild.config.ts — refusing to patch it`)
  process.exit(1)
}

const setRows = n => fs.writeFileSync(ROWS_CONFIG, `export const INITIAL_ROWS = ${n}\n`)
// Takes a BOOLEAN: the replacement is the plugin call, so a boolean must be
// mapped here — passing one straight into `replace` writes `plugins: [false]`.
const setIfr = on => fs.writeFileSync(LYNX_CONFIG, originalLynx.replace(OFF, on ? ON : OFF))
const setReactRows = n => fs.writeFileSync(REACT_ROWS_CONFIG, `export const INITIAL_ROWS = ${n}\n`)

/**
 * Refuse to measure an arm whose label and bytes disagree. `ifr` must be
 * materially larger than `def` (measured 47-105% across examples); an IFR arm
 * that came out the same size means the option never reached the lynx
 * environment — the `style-demo` trap: `patchOn` hit the web plugin call, the
 * sweep happily measured two copies of the default arm and printed a Δ.
 */
function assertArmSet(n, sizes) {
  if (sizes.ifr <= sizes.def * 1.2) {
    throw new Error(
      `rows=${n}: IFR arm is ${sizes.ifr}B against default ${sizes.def}B — the `
      + 'enableMtIfr option did not reach the bundle being measured. Refusing to '
      + 'measure a mislabelled arm (check which environment the plugin call sits in).',
    )
  }
}

const gitRev = gitState()
const fp = fingerprint()
const manifest = readManifest()

/** Reuse only arms whose bytes and inputs the manifest can vouch for. */
function freshArm(name) {
  const file = path.join(STASH, `${name}.lynx.bundle`)
  const rec = manifest[name]
  if (!rec)
    return { ok: false, why: 'no manifest entry' }
  if (!fs.existsSync(file))
    return { ok: false, why: 'bundle missing from stash' }
  if (rec.fingerprint !== fp)
    return { ok: false, why: 'sources or package dist changed since it was built' }
  if (rec.sha256 !== sha256File(file))
    return { ok: false, why: 'bundle bytes differ from the manifest' }
  return { ok: true, rec }
}

/** Build one arm and copy its bundle out of `dist/` (the next build clears it). */
function buildArm(name, { rows, ifr = false, react = false }) {
  let bundle
  if (react) {
    setReactRows(rows)
    sh('nub', ['run', '-F', '@lynx-solid/dev-bench-table-react', 'build'], ROOT, { quiet: true })
    bundle = path.join(REACT_DEMO, 'dist/main.lynx.bundle')
  }
  else {
    setRows(rows)
    setIfr(ifr)
    sh('nub', ['run', '-F', '@lynx-solid/dev-bench-table', 'build'], ROOT, { quiet: true })
    bundle = path.join(DIST, 'main.lynx.bundle')
  }
  const size = fs.statSync(bundle).size
  const stashFile = path.join(STASH, `${name}.lynx.bundle`)
  fs.copyFileSync(bundle, stashFile)
  manifest[name] = {
    size,
    sha256: sha256File(stashFile),
    fingerprint: fp,
    git: gitRev,
    builtAt: new Date().toISOString(),
  }
  writeManifest(manifest)
  return size
}

/** `--skip-build`: reuse proven arms, rebuild anything the manifest cannot vouch for. */
function ensureArm(name, opts) {
  if (a['skip-build']) {
    const fresh = freshArm(name)
    if (fresh.ok) {
      console.log(`  reused ${name} (${fresh.rec.size}B, built ${fresh.rec.builtAt} from ${fresh.rec.git})`)
      return fresh.rec.size
    }
    console.log(`  rebuild ${name}: ${fresh.why}`)
  }
  return buildArm(name, opts)
}

function publish() {
  for (const name of names) {
    const from = path.join(STASH, `${name}.lynx.bundle`)
    if (fs.existsSync(from))
      fs.copyFileSync(from, path.join(DIST, `${name}.lynx.bundle`))
  }
}

function armArgs(prefix, name, label) {
  return [
    `--${prefix}-bundle`,
    path.join(DIST, `${name}.lynx.bundle`),
    `--${prefix}-url`,
    `${a.url}/${name}.lynx.bundle`,
    `--${prefix}-name`,
    label,
  ]
}

function measure(n) {
  const jsonPath = path.join(STASH, `sweep-${n}${a.tag}.json`)
  const args = [
    DRIVER,
    '--serial',
    a.serial,
    '--label',
    `sweep-${n}${a.tag}`,
    '--reps',
    a.reps,
    '--json',
    jsonPath,
    ...armArgs('a', `def-${n}`, 'our-default'),
    ...armArgs('b', `ifr-${n}`, 'our-ifr'),
  ]
  if (a.react)
    args.push(...armArgs('c', `react-${n}`, 'react'))
  for (const knob of ['gap', 'retries']) {
    if (a[knob])
      args.push(`--${knob}`, a[knob])
  }
  // `inherit`: one point takes minutes, so its progress must stream rather than
  // appear in one burst when the child exits. The numbers come from `--json`.
  sh('node', args, ROOT, { inherit: true })
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
}

/**
 * What an arm contributes at this point: the median of its reps' first-screen
 * frames. There is one class of number — a frame that cleared the duration floor
 * — so a resolved arm always has a median; `NaN` means it lost reps, not that it
 * measured them through another door. `preReady` is reported as context only.
 */
function valueOf(s) {
  if (s.median !== null)
    return { v: s.median, iqr: s.iqr, note: '' }
  return { v: Number.NaN, iqr: null, note: '' }
}

fs.mkdirSync(STASH, { recursive: true })
const points = []
try {
  for (const n of rowsList) {
    const sizes = {
      def: ensureArm(`def-${n}`, { rows: n, ifr: false }),
      ifr: ensureArm(`ifr-${n}`, { rows: n, ifr: true }),
      react: a.react ? ensureArm(`react-${n}`, { rows: n, react: true }) : null,
    }
    assertArmSet(n, sizes)
    const growth = Math.round((sizes.ifr / sizes.def - 1) * 100)
    console.log(
      `  rows=${String(n).padStart(4)}  def=${sizes.def}B ifr=${sizes.ifr}B`
      + `${sizes.react === null ? '' : ` react=${sizes.react}B`}  (ifr +${growth}%)`,
    )
  }
  console.log(`  fingerprint ${fp} | git ${gitRev}`)
  publish()
  for (const n of rowsList) {
    const r = measure(n)
    const [def, ifr, react] = r.summary
    points.push({ n, def: valueOf(def), ifr: valueOf(ifr), react: react ? valueOf(react) : null })
  }
}
finally {
  // Everything the sweep patches is restored from the copies taken at startup,
  // at the very end — the pristine rebuild below re-patches the same files.
  const restore = () => {
    fs.writeFileSync(ROWS_CONFIG, originalRows)
    fs.writeFileSync(LYNX_CONFIG, originalLynx)
    if (originalReactRows !== null)
      fs.writeFileSync(REACT_ROWS_CONFIG, originalReactRows)
  }
  restore()
  if (a['rebuild-pristine']) {
    // Neither example's `dist/main.lynx.bundle` may be left as a sweep arm: the
    // docs pipeline and the QR/preview steps read that name.
    setRows(0)
    setIfr(false)
    sh('nub', ['run', '-F', '@lynx-solid/dev-bench-table', 'build'], ROOT, { quiet: true })
    if (a.react) {
      setReactRows(1000)
      sh('nub', ['run', '-F', '@lynx-solid/dev-bench-table-react', 'build'], ROOT, { quiet: true })
    }
    restore()
    publish()
    console.log('  restored both examples and rebuilt their dist/main.lynx.bundle pristine')
  }
  else {
    console.log('  restored the examples (dist/main.lynx.bundle NOT rebuilt — it is still a sweep arm)')
  }
}

console.log('\n=== row sweep (median ms [IQR], am_proc_start → first content frame) ===')
const head = ['  rows      default'.padEnd(18), 'IFR'.padEnd(24)]
if (a.react)
  head.push('React'.padEnd(24), 'Δ ifr−def   Δ react−ifr')
console.log(head.join(' '))
function fmt(x) {
  return x && Number.isFinite(x.v)
    ? `${String(x.v).padStart(5)} [${x.iqr[0]}, ${x.iqr[1]}]${x.note}`.padEnd(24)
    : '—'.padEnd(24)
}
for (const p of points) {
  const cells = [String(p.n).padStart(4).padEnd(8), fmt(p.def), fmt(p.ifr)]
  const dIFR = p.ifr.v - p.def.v
  const cells2 = [`${dIFR > 0 ? '+' : ''}${dIFR}`.padEnd(11)]
  if (a.react) {
    cells.push(fmt(p.react))
    const dReact = p.react.v - p.ifr.v
    cells2.push(`${dReact > 0 ? '+' : ''}${dReact}`)
  }
  console.log(`  ${cells[0]} ${cells.slice(1).join(' ')} ${cells2.join(' ')}`)
}
console.log('  every value is the first `layout finish` that cleared the duration floor (see tracker.mjs);')
console.log('  a frame that landed before `lynx runtime ready` counts the same and is noted in the JSON as preReady')
console.log('  Δ ifr−def   > 0 → IFR costs more than our default at that size')
console.log('  Δ react−ifr > 0 → ReactLynx costs more than our IFR at that size')

{
  const ls = (pts, get) => {
    const xs = pts.map(p => p.n)
    const ys = pts.map(get)
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length
    const my = ys.reduce((s, y) => s + y, 0) / ys.length
    let num = 0
    let den = 0
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my)
      den += (xs[i] - mx) ** 2
    }
    const k = num / den
    return { k, b: my - k * mx }
  }
  const series = [
    ['default', p => p.def],
    ['ifr', p => p.ifr],
  ]
  if (a.react)
    series.push(['react', p => p.react])
  const usable = p => series.every(([, get]) => Number.isFinite(get(p).v))
  const all = points.filter(usable)
  // The per-row cost is not constant all the way out: the 500-1000 segment
  // steepens on every arm (a 1000-row table is where the render stops scaling
  // linearly), and including it drags every intercept 60-100 ms below the
  // measured 0-row value — i.e. it turns fixed cost into fiction. The crossovers
  // live in the linear region, so fit there and say where.
  const pts = all.filter(p => p.n <= Number(a['fit-max']))
  if (pts.length >= 2) {
    const excluded = all.length - pts.length
    console.log(`\n=== linear fit over the ${pts.length} points with N <= ${a['fit-max']} ${excluded ? `(${excluded} steeper point(s) excluded) ` : ''}===`)
    const fits = {}
    for (const [name, get] of series) {
      fits[name] = ls(pts, p => get(p).v)
      console.log(`  ${name.padEnd(8)} ${fits[name].b.toFixed(1)} + ${fits[name].k.toFixed(3)}·N`)
    }
    // A fit is only worth quoting if its intercept is a fixed cost and not an
    // extrapolation, so print what the 0-row window actually measured next to it.
    const at0 = all.filter(p => p.n === 0)
    if (at0.length)
      console.log(`  at N=0 measured: ${series.map(([name, get]) => `${name} ${get(at0[0]).v} (fit ${fits[name].b.toFixed(0)})`).join(' | ')}`)
    const cross = (x, y) => {
      // Two lines cross when one is better at N=0 and the other grows slower.
      // The earlier version only handled (higher intercept + steeper slope) and
      // so reported "never" for React vs IFR, which does cross.
      const db = fits[y].b - fits[x].b // > 0 → x is faster at N = 0
      const dk = fits[x].k - fits[y].k // > 0 → x grows faster
      const below = db > 0 ? x : y
      const above = db > 0 ? y : x
      if (db === 0)
        return 'no crossover (identical fixed cost)'
      if (dk === 0)
        return `no crossover (${below} faster at every N)`
      const at = db / dk
      // `at <= 0` means db and dk have OPPOSITE signs: the arm that is faster at
      // N=0 is also the one that grows slower, so it is faster at every N — that
      // arm is `below`, not `above`. (Only reachable when one arm dominates; on
      // the desktop grid React vs IFR crosses, so this branch went unexercised
      // until a device fit had a strictly better intercept AND slope.)
      return at <= 0
        ? `no crossover (${below} faster at every N)`
        : `${Math.round(at)} rows (${below} faster below, ${above} faster above)`
    }
    console.log(`  crossover (fixed advantage / marginal penalty):`)
    console.log(`    ifr vs default : ${cross('default', 'ifr')}`)
    if (a.react) {
      console.log(`    ifr vs react   : ${cross('react', 'ifr')}`)
      console.log(`    default vs react: ${cross('react', 'default')}`)
    }
  }
}
