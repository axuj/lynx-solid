/**
 * Real-device examples sweep — runtime breadth on an actual Lynx host
 * (the axis vue-lynx-vapor deferred to "on-device traces… next step").
 *
 * For every examples/<name>/dist/*.lynx.bundle: cold-open via
 * `lynx://open?url=…` (machine twin of the QR scan), measure open →
 * content-ready through two independent channels, N reps, median:
 *   logcat    — first engine/JS milestone line after open (ms, host-corrected
 *               clock); chosen when the engine emits a usable marker
 *   screencap — PNG frame poll with a decoded content score (share of
 *               non-background pixels in the mid-screen band); ~poll-precision
 * Both are recorded; the report's primary column prefers logcat.
 *
 * Method caveats (recorded in the report): open→content includes Explorer
 * cold start + LAN fetch + BG eval + render + IPC — one device-opaque chain;
 * precision = channel latency, not vsync; numbers are breadth rankings, not
 * cross-device absolutes. No browser is involved anywhere.
 *
 * Usage: node harness/sweep-device.mjs [--reps 3] [--only a,b] [--port 8402]
 *        [--channel auto|logcat|screencap] [--timeout 7000] [--probe entry]
 * Output: results/examples-sweep-device.json + .md
 */
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { wakeDevice, withScreenAwake } from './keep-awake.mjs'
import { stats } from './stats.mjs'
import { listBundles, MIME, sizeOf } from './sweep-lib.mjs'
import { CONTENT_SCORE_MIN, contentScore, decodePng } from './sweep-png.mjs'

const harnessDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(harnessDir, '../../..')
const resultsDir = path.join(root, 'packages/benchmark/results')
const examplesDir = path.join(root, 'examples')

const { values: args } = parseArgs({
  options: {
    'reps': { type: 'string', default: '3' },
    'only': { type: 'string', default: '' },
    'port': { type: 'string', default: '8402' },
    'channel': { type: 'string', default: 'auto' },
    'timeout': { type: 'string', default: '7000' },
    'probe': { type: 'string', default: '' },
    // Upper bound for how long this run may keep the screen awake, in minutes.
    // `screen_off_timeout` is persistent (survives reboots, applies to the whole
    // phone), so it is bounded rather than "never" and written back on exit.
    'keep-awake-min': { type: 'string', default: '60' },
  },
})
const KEEP_AWAKE_MIN = Number(args['keep-awake-min'])
const REPS = Math.max(1, Number(args.reps))
const PORT = Number(args.port)
const TIMEOUT = Number(args.timeout)
const CHANNEL = args.channel
const ONLY = args.only
  ? new Set(args.only.split(',').map(s => s.trim()).filter(Boolean))
  : null

// Engine milestone candidates (priority order — first pattern with any hit
// wins, not the earliest chronologically-weaker line). Confirmed on-device
// via --probe: __OnAppFirstScreen dispatches right after lynxSolidApplyOps
// lands (OnPatchFinishForFiber +3ms, layout finish +10ms).
const LOGCAT_PATTERNS = [
  /__OnAppFirstScreen/,
  /OnPatchFinishForFiber/,
  /__OnNativeAppReady/,
]
// Ignore the explorer window-open transition in the screencap fallback —
// launcher pixels during the crossfade would otherwise score as content.
const SCREENCAP_GRACE_MS = 600

function adb(serial, argv, { allowFail = false } = {}) {
  const res = spawnSync('adb', serial ? ['-s', serial, ...argv] : argv, {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  if (res.error)
    throw res.error
  if (res.status !== 0 && !allowFail)
    throw new Error(`adb ${argv.join(' ')} → ${res.status}: ${out.slice(0, 300)}`)
  return out
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function lanIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith('192.168.'))
        return a.address
    }
  }
  throw new Error('no 192.168.* LAN address found — device and PC must share Wi-Fi')
}

/** Connected serial, with mdns rediscovery when the wireless port rotated. */
function ensureSerial(want) {
  const list = () => adb(null, ['devices'])
    .split('\n')
    .slice(1)
    .map(l => l.trim())
    .filter(l => l.endsWith('\tdevice'))
    .map(l => l.split('\t')[0])
    .filter(s => !s.includes('_adb-tls-connect'))
  let serials = list()
  if (want && serials.includes(want))
    return want
  if (!want && serials.length > 0)
    return serials[0]
  // wireless port rotation: rediscover via mdns and connect
  const mdns = adb(null, ['mdns', 'services'], { allowFail: true })
  const cands = [...mdns.matchAll(/adb-(\d+\.\d+\.\d+\.\d+:\d+)\._adb-tls-connect/g)].map(m => m[1])
  for (const c of cands)
    adb(null, ['connect', c], { allowFail: true })
  serials = list()
  if (want && serials.includes(want))
    return want
  if (!want && serials.length > 0)
    return serials[0]
  throw new Error(`no adb device connected (mdns candidates: ${cands.join(', ') || 'none'})`)
}

/** Host↔device clock offset in ms (device epoch = host epoch + offset). */
function clockOffset(serial) {
  const out = adb(serial, ['shell', 'date', '+%s%3N'], { allowFail: true }).trim()
  const dev = Number(out.split('\n').pop())
  if (!Number.isFinite(dev))
    return 0
  return dev - Date.now()
}

/** Static dist server for the device (Content-Length is load-bearing). */
function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0]
    const m = /^\/([^/]+)\/([^/]+)$/.exec(urlPath)
    console.log(`[sweep-device] GET ${urlPath} ${m ? '' : '(no match)'}`)
    if (m) {
      const base = path.resolve(path.join(examplesDir, m[1], 'dist'))
      const file = path.resolve(path.join(base, m[2]))
      if (file.startsWith(base + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const stat = fs.statSync(file)
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Length': stat.size,
        })
        fs.createReadStream(file).pipe(res)
        return
      }
    }
    res.writeHead(404)
    res.end('not found')
  })
  return new Promise(resolve => server.listen(PORT, '0.0.0.0', () => resolve(server)))
}

function screencapPng(serial) {
  const res = spawnSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
    timeout: 15_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (res.status !== 0 || !res.stdout || res.stdout.length < 100)
    return null
  const buf = Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout, 'binary')
  return buf[0] === 0x89 && buf[1] === 0x50 ? buf : null
}

/**
 * Poll both channels until content is proven or the deadline passes.
 * Returns { logcatMs, screencapMs, detail } — either may be null (DNF).
 */
async function measure(serial, openAt, offset, deadline) {
  const DEBUG = Boolean(process.env.SWEEP_DEBUG)
  let logcatMs = null
  let screencapMs = null
  let logcatFoundAt = null
  let detail = ''
  let sawMatchingLine = ''
  let dumpLen = 0
  let lastScore = ''
  while (Date.now() < deadline) {
    if (logcatMs === null) {
      const dump = adb(serial, ['logcat', '-d', '-v', 'epoch'], { allowFail: true })
      dumpLen = dump.length
      for (const pat of LOGCAT_PATTERNS) {
        let best = null
        for (const line of dump.split('\n')) {
          if (!pat.test(line))
            continue
          // -v epoch → "1759391234.567 …" (lines may be indented in dumps)
          const m = /^\s*(\d{10,13}\.\d{1,9})\s/.exec(line)
          if (!m)
            continue
          const t = Math.round(Number.parseFloat(m[1]) * 1000)
          if (!Number.isFinite(t) || t < openAt + offset - 50)
            continue
          if (!best || t < best.t)
            best = { t, line }
        }
        if (best) {
          sawMatchingLine = best.line.trim().slice(0, 220)
          logcatMs = Math.round(best.t - offset - openAt)
          logcatFoundAt = Date.now()
          break
        }
      }
    }
    if (screencapMs === null && Date.now() >= openAt + SCREENCAP_GRACE_MS) {
      const png = screencapPng(serial)
      if (png) {
        try {
          const score = contentScore(decodePng(png))
          lastScore = score.toFixed(4)
          if (score >= CONTENT_SCORE_MIN)
            screencapMs = Date.now() - openAt
          else
            detail = `score=${score.toFixed(3)}`
        }
        catch (e) {
          detail = `decode: ${String(e).slice(0, 80)}`
        }
      }
      else {
        detail = 'screencap-failed'
      }
    }
    if (logcatMs !== null && screencapMs !== null)
      break
    // screencap found + logcat idle grace → the engine has no usable marker
    if (logcatMs !== null && logcatFoundAt && Date.now() - logcatFoundAt > 1500)
      break
    if (screencapMs !== null && CHANNEL === 'auto' && Date.now() - screencapMs > 2000)
      break
    await sleep(150)
  }
  if (logcatMs === null)
    detail = `${detail} dump=${dumpLen}b lastScore=${lastScore || '?'}`.trim()
  if (DEBUG)
    console.log(`[measure] t=+${Date.now() - openAt}ms logcat=${logcatMs ?? '-'} screencap=${screencapMs ?? '-'} ${detail}`)
  return { logcatMs, screencapMs, detail, sawMatchingLine }
}

function medianOrNull(arr) {
  const ok = arr.filter(v => typeof v === 'number')
  return ok.length > 0 ? Math.round(stats(ok).median) : null
}

// Dev-form markers — the same ones prepare-examples gates on. A running
// `rsbuild dev` overwrites examples/*/dist with an uncompressed, debug-banner
// build (writeToDisk defaults to true), so a sweep run picks up whatever was
// on disk: its timings and gzip column would then describe a bundle nobody
// ships. Flagged per row rather than footnoted, so every run re-emits it.
const DEV_FORM_MARKERS = ['__DEBUG_METADATA_RELEASE__', 'var __webpack_modules__ = ']

/**
 * Per-row caveats, computed so a re-run re-emits them without anyone
 * remembering to hand-write a footnote. Surfaced in the report's notes column.
 */
function rowNotes(file, r) {
  const notes = []
  if (DEV_FORM_MARKERS.some(m => fs.readFileSync(file, 'utf8').includes(m)))
    notes.push('dev-form bundle, not a shipped build')
  if (r.logcatMs != null && r.screencapMs == null)
    notes.push('logcat milestone only, no visual confirmation')
  return notes
}

/** One entry: force-stop → baseline → open → measure, per rep. */
async function runEntry(serial, row, base, offset) {
  // A dark display measures a partial layout, not the app — and it still
  // produces a number. Refuse rather than publish a whole sweep of them.
  if (!/mWakefulness=Awake/.test(adb(serial, ['shell', 'dumpsys', 'power'], { allowFail: true }))) {
    console.error(`[sweep-device] screen is not awake before ${row.example}/${row.entry} — aborting`)
    process.exit(1)
  }
  const url = `http://${base}/${row.example}/${row.entry}?cb=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const reps = []
  let sawLine = ''
  let detail = ''
  for (let i = 0; i < REPS; i++) {
    adb(serial, ['shell', 'am', 'force-stop', 'com.lynx.explorer'], { allowFail: true })
    await sleep(500)
    adb(serial, ['logcat', '-c'], { allowFail: true })
    const openUri = `lynx://open?url=${encodeURIComponent(url)}`
    const openAt = Date.now()
    adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', openUri], { allowFail: true })
    const r = await measure(serial, openAt, offset, openAt + TIMEOUT)
    reps.push(r)
    if (r.sawMatchingLine && !sawLine)
      sawLine = r.sawMatchingLine
    if (r.detail)
      detail = r.detail
  }
  adb(serial, ['shell', 'am', 'force-stop', 'com.lynx.explorer'], { allowFail: true })
  const logcatMs = medianOrNull(reps.map(r => r.logcatMs))
  const screencapMs = medianOrNull(reps.map(r => r.screencapMs))
  const primary = CHANNEL === 'logcat' ? logcatMs : CHANNEL === 'screencap' ? screencapMs : (logcatMs ?? screencapMs)
  const channel = primary == null ? '—' : (primary === logcatMs && logcatMs != null ? 'logcat' : 'screencap')
  return {
    logcatMs,
    screencapMs,
    openMs: primary,
    channel,
    reps: reps.map(r => ({ logcat: r.logcatMs, screencap: r.screencapMs })),
    status: primary == null ? 'DNF' : 'ok',
    sawLine,
    detail,
  }
}

function logcatErrors(serial) {
  const log = adb(serial, ['logcat', '-d', '-t', '400'], { allowFail: true })
  return log
    .split('\n')
    .filter(l => /JS ERROR|AndroidRuntime|FATAL|lynx-solid.*(?:failed|error)/i.test(l))
    .slice(-5)
}

function saveFailShot(serial) {
  try {
    fs.mkdirSync(resultsDir, { recursive: true })
    const res = spawnSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 15_000, maxBuffer: 32 * 1024 * 1024 })
    if (res.status === 0 && res.stdout)
      fs.writeFileSync(path.join(resultsDir, 'examples-sweep-device-FAIL.png'), Buffer.from(res.stdout))
  }
  catch {}
}

/** Probe mode: one entry, dump raw evidence for channel refinement. */
async function probe(serial, entryName, base) {
  const { allLynx } = listBundles(examplesDir, ONLY)
  const row = allLynx.find(r => r.entry === entryName || `${r.example}/${r.entry}` === entryName)
  if (!row)
    throw new Error(`probe entry not found: ${entryName} (have ${allLynx.slice(0, 5).map(r => r.entry).join(', ')}…)`)
  console.log(`[sweep-device] probe ${row.example}/${row.entry}`)
  adb(serial, ['shell', 'am', 'force-stop', 'com.lynx.explorer'], { allowFail: true })
  await sleep(500)
  adb(serial, ['logcat', '-c'], { allowFail: true })
  const url = `http://${base}/${row.example}/${row.entry}?cb=probe-${Date.now()}`
  adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `lynx://open?url=${encodeURIComponent(url)}`])
  console.log(`[sweep-device] opened, waiting ${TIMEOUT}ms…`)
  await sleep(TIMEOUT)
  fs.mkdirSync(resultsDir, { recursive: true })
  const log = adb(serial, ['logcat', '-d', '-v', 'epoch'], { allowFail: true })
  fs.writeFileSync(path.join(resultsDir, 'device-probe.log'), log)
  const png = screencapPng(serial)
  let score = null
  let dims = null
  if (png) {
    fs.writeFileSync(path.join(resultsDir, 'device-probe.png'), png)
    try {
      const img = decodePng(png)
      dims = `${img.width}x${img.height} ch=${img.channels}`
      score = contentScore(img).toFixed(4)
    }
    catch (e) {
      score = `decode error: ${e.message}`
    }
  }
  const layers = adb(serial, ['shell', 'dumpsys', 'SurfaceFlinger', '--list'], { allowFail: true })
  fs.writeFileSync(path.join(resultsDir, 'device-probe-layers.txt'), layers)
  const uia = adb(serial, ['shell', 'uiautomator', 'dump', '/sdcard/probe.xml'], { allowFail: true })
  const uiaXml = adb(serial, ['shell', 'cat', '/sdcard/probe.xml'], { allowFail: true })
  fs.writeFileSync(path.join(resultsDir, 'device-probe-ui.xml'), uiaXml || uia)
  console.log(`[sweep-device] probe done: contentScore=${score} dims=${dims}`)
  console.log(`[sweep-device] wrote results/device-probe.{log,png} + device-probe-layers.txt + device-probe-ui.xml`)
}

async function main() {
  const serial = ensureSerial()
  const ip = lanIp()
  const offset = clockOffset(serial)
  const model = adb(serial, ['shell', 'getprop', 'ro.product.model']).trim()
  const sdk = adb(serial, ['shell', 'getprop', 'ro.build.version.sdk']).trim()
  console.log(`[sweep-device] serial=${serial} lan=${ip}:${PORT} model=${model} sdk=${sdk} clockOffset=${offset}ms channel=${CHANNEL}`)

  // keep the screen alive for the whole run (bounded, restored on exit)
  // Wake/unlock before the first launch; keep the screen alive for the whole
  // run (bounded, restored on exit). A secure lock cannot be bypassed over adb.
  withScreenAwake({ adb: (argv, opts) => adb(serial, argv, opts), minutes: KEEP_AWAKE_MIN, label: 'sweep-device' })
  const wake = await wakeDevice({ adb: (argv, opts) => adb(serial, argv, opts), label: 'sweep-device' })
  if (!wake.awake || wake.keyguard) {
    console.error(wake.keyguard
      ? 'keyguard is showing — unlock the phone and rerun (adb cannot bypass a secure lock)'
      : 'screen did not wake — wake the phone and rerun')
    process.exit(1)
  }

  const server = await startServer()
  const base = `${ip}:${PORT}`
  try {
    if (args.probe) {
      await probe(serial, args.probe, base)
      return
    }

    const { allLynx } = listBundles(examplesDir, ONLY)
    if (allLynx.length === 0) {
      console.error('[sweep-device] no bundles found')
      process.exit(1)
    }
    console.log(`[sweep-device] ${allLynx.length} bundles × ${REPS} rep(s)`)

    const rows = []
    for (const row of allLynx) {
      // wireless port may rotate mid-run — re-resolve per entry
      const ser = ensureSerial(serial)
      const r = await runEntry(ser, row, base, clockOffset(ser))
      const errs = logcatErrors(ser)
      const size = sizeOf(row.file)
      const entry = {
        example: row.example,
        entry: row.entry,
        openMs: r.openMs,
        channel: r.channel,
        logcatMs: r.logcatMs,
        screencapMs: r.screencapMs,
        reps: r.reps,
        status: r.status,
        lynxRaw: size.raw,
        lynxGzip: size.gzip,
        errors: errs,
        notes: rowNotes(row.file, r),
      }
      rows.push(entry)
      if (r.status === 'DNF')
        saveFailShot(ser)
      console.log(
        `[sweep-device] ${entry.example}/${entry.entry} open=${entry.openMs ?? 'DNF'}ms (${entry.channel})`
        + ` logcat=${entry.logcatMs ?? '–'} screencap=${entry.screencapMs ?? '–'}`
        + `${errs.length ? ` errors=${errs.length}` : ''}`
        + `${entry.notes.length ? ` NOTE[${entry.notes.join('; ')}]` : ''}`
        + `${r.sawLine ? ` line="${r.sawLine.slice(0, 80)}"` : ''}`,
      )
    }

    const flagged = rows.filter(r => r.notes.length > 0)

    const result = {
      meta: {
        date: new Date().toISOString(),
        model,
        sdk,
        serial,
        channel: CHANNEL,
        reps: REPS,
        timeoutMs: TIMEOUT,
        clockOffsetMs: offset,
        host: `${os.cpus().length}× ${os.cpus()[0]?.model ?? '?'}`,
        method: 'cold open per rep (force-stop → lynx://open) — open→content includes Explorer cold start + LAN fetch + BG eval + render; primary = logcat milestone when present, else PNG content-score transition; no browser involved',
      },
      rows,
    }
    fs.mkdirSync(resultsDir, { recursive: true })
    fs.writeFileSync(path.join(resultsDir, 'examples-sweep-device.json'), `${JSON.stringify(result, null, 2)}\n`)

    let md = `# Examples sweep — real device runtime (breadth axis)\n\n`
    md += `- date: ${result.meta.date}\n- device: ${model} (Android SDK ${sdk}), serial ${serial}\n`
    md += `- reps: ${REPS} (cold open each), channel: ${CHANNEL}, timeout ${TIMEOUT}ms\n`
    md += `- method: ${result.meta.method}\n`
    md += `- related: bundle sizes in examples-sweep.md; reference: vue-lynx-vapor examples-sweep\n`
    md += `| example | entry | open→content ms | channel | logcat | screencap | lynx gzip | status | errors | notes |\n`
    md += `|---|---|---|---|---|---|---|---|---|---|\n`
    for (const r of rows) {
      md += `| ${r.example} | ${r.entry} | ${r.openMs ?? 'DNF'} | ${r.channel} | ${r.logcatMs ?? '—'} | ${r.screencapMs ?? '—'}`
        + ` | ${r.lynxGzip} | ${r.status} | ${r.errors.length || '—'} | ${r.notes.length ? `⚠ ${r.notes.join('; ')}` : '—'} |\n`
    }
    const dnfs = rows.filter(r => r.status === 'DNF')
    if (dnfs.length > 0)
      md += `\n> DNF: no content frame/logcat milestone within ${TIMEOUT}ms across ${REPS} reps — last failure screenshot in examples-sweep-device-FAIL.png.\n`
    if (flagged.length > 0) {
      md += `\n## Flagged rows (do not quote these without re-running them)\n\n`
      for (const r of flagged)
        md += `- **${r.example}/${r.entry}** — ${r.notes.join('; ')}\n`
    }
    const lines = [...new Set(rows.map(r => r.sawLine).filter(Boolean))]
    if (lines.length > 0) {
      md += `\n## Matched logcat milestones\n\n`
      for (const l of lines)
        md += `- \`${l.replace(/`/g, '')}\`\n`
    }
    fs.writeFileSync(path.join(resultsDir, 'examples-sweep-device.md'), md)
    console.log(`[sweep-device] wrote results/examples-sweep-device.{json,md} (${rows.length} entries, ${dnfs.length} DNF)`)
  }
  finally {
    adb(serial, ['shell', 'am', 'force-stop', 'com.lynx.explorer'], { allowFail: true })
    server.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
