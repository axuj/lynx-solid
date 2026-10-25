/**
 * Device runner — Phase E (native host).
 *
 * Pipeline:
 *   build device-lab (report URL injected) → serve dist + POST /report on
 *   LAN → cold-start Explorer via `lynx://open?url=…` (the machine twin of
 *   the QR scan) → collect heartbeat (open→content) + final case report →
 *   screencap → markdown/json results.
 *
 * Tap capability: this device's MIUI blocks `adb shell input` (INJECT_EVENTS
 * SecurityException) unless "USB debugging (Security settings)" is enabled.
 * Without it the sign-event case runs in manual mode (a human taps TAP ME).
 *
 * Usage: node harness/device.mjs [--serial x] [--label name] [--tap-wait 15000]
 *        [--tap-x 300 --tap-y 400] [--port 4200] [--no-build] [--keep-open]
 *        [--stamp] [--ifr]
 * Arms: default (dist/) vs `--ifr` (dist-ifr/, LYNX_MT_IFR=1) — the same app
 * built with and without main-thread first screen. The runtime installs its
 * queueMicrotask guard on the BG only; the MT context provides its own, so
 * `mt-queue-microtask-guard` reads the same in both arms and `bg-queue-microtask`
 * is where the guard shows up (its `src` is the guard's JS arrow).
 * Records: always <arm>-latest.{json,md,png} — device-selftest-latest.* for
 * the default arm, device-selftest-ifr-latest.* for `--ifr` (one living record
 * per arm; git history of `latest` is the run timeline). Per-run copies
 * (device-selftest-<label>.*, label defaults to an ISO timestamp) are only
 * written with --label or --stamp, so runs don't accumulate files in git.
 * Failures always write <arm>-latest-FAIL.png (fixed name, overwritten).
 */
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { wakeDevice, withScreenAwake } from './keep-awake.mjs'

const harnessDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(harnessDir, '../../..')
const resultsDir = path.join(root, 'packages/benchmark/results')
// Two arms, two output dirs: the default build (`dist/`) and the IFR build
// (`dist-ifr/`, switched by LYNX_MT_IFR in the example's config). Assigned
// after parseArgs, once we know which arm this run is.
let distDir = path.join(root, 'examples/device-lab/dist')

const { values: args } = parseArgs({
  options: {
    'serial': { type: 'string', default: '' },
    'label': { type: 'string', default: '' },
    'tap-wait': { type: 'string', default: '15000' },
    'tap-x': { type: 'string', default: '' },
    'tap-y': { type: 'string', default: '' },
    'port': { type: 'string', default: '4200' },
    'no-build': { type: 'boolean', default: false },
    'keep-open': { type: 'boolean', default: false },
    'stamp': { type: 'boolean', default: false },
    'ifr': { type: 'boolean', default: false },
    // Upper bound for how long this run may keep the screen awake, in minutes.
    // The setting is persistent (survives reboots, applies to the whole phone),
    // so it is bounded rather than "never".
    'keep-awake-min': { type: 'string', default: '60' },
  },
})
const PORT = Number(args.port)
const TAP_WAIT = Number(args['tap-wait'])
const TAP_X = args['tap-x'] ? Number(args['tap-x']) : null
const TAP_Y = args['tap-y'] ? Number(args['tap-y']) : null
const KEEP_AWAKE_MIN = Number(args['keep-awake-min'])

// `--ifr` runs the arm whose MT entry installs the queueMicrotask guard. The
// default arm installs nothing on the MT, which is exactly what the lab's
// `mt-queue-microtask-guard` case reports (`before=undefined` vs
// `before=function`), so both arms are needed to read that case.
if (args.ifr)
  distDir = path.join(root, 'examples/device-lab/dist-ifr')

function adb(serial, argv, { allowFail = false } = {}) {
  const res = spawnSync('adb', serial ? ['-s', serial, ...argv] : argv, {
    encoding: 'utf8',
    timeout: 30_000,
  })
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  if (res.error)
    throw res.error
  if (res.status !== 0 && !allowFail)
    throw new Error(`adb ${argv.join(' ')} → ${res.status}: ${out.slice(0, 400)}`)
  return out
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

function pickSerial(want) {
  const out = adb(null, ['devices'])
  const serials = out
    .split('\n')
    .slice(1)
    .map(l => l.trim())
    .filter(l => l.endsWith('\tdevice'))
    .map(l => l.split('\t')[0])
    .filter(s => !s.includes('_adb-tls-connect')) // discovery entries, not sessions
  if (want)
    return serials.includes(want) ? want : (() => { throw new Error(`serial ${want} not connected (have: ${serials.join(', ') || 'none'})`) })()
  if (serials.length === 0)
    throw new Error('no adb device connected')
  return serials[0]
}

const MIME = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.bundle': 'application/octet-stream',
}

/** Static dist + report receiver. Resolves { heartbeat, final } promises. */
function startServer(port, ip) {
  const state = { heartbeat: null, final: null, heartbeatAt: null, finalAt: null, log: [] }
  const waiters = { heartbeat: [], final: [] }
  const deliver = (kind, payload) => {
    state[kind] = payload
    state[`${kind}At`] = Date.now()
    for (const w of waiters[kind].splice(0))
      w(payload)
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${ip}:${port}`)
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }
    if (req.method === 'POST' && url.pathname === '/report') {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', () => {
        try {
          const payload = JSON.parse(body)
          state.log.push({ at: Date.now(), kind: payload.kind })
          console.log(`[device] report kind=${payload.kind}`)
          if (payload.kind === 'heartbeat' || payload.kind === 'final')
            deliver(payload.kind, payload)
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
          res.end('{"ok":true}')
        }
        catch (e) {
          res.writeHead(400, cors)
          res.end(String(e))
        }
      })
      return
    }
    const filePath = url.pathname === '/' || url.pathname === '/selftest.lynx.bundle'
      ? path.join(distDir, url.pathname === '/' ? 'selftest.lynx.bundle' : url.pathname.slice(1))
      : path.join(distDir, url.pathname.slice(1))
    if (url.pathname === '/health') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
      return
    }
    // Every request matters while bringing up the device channel.
    const ok = filePath.startsWith(distDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    console.log(`[device] GET ${url.pathname} -> ${ok ? '200' : '404'} (${req.headers['user-agent'] ?? '?'})`)
    if (!ok) {
      res.writeHead(404, cors)
      res.end('not found')
      return
    }
    // Content-Length is load-bearing: with chunked streaming the device-side
    // template fetcher aborts mid-body ("Software caused connection abort",
    // errCode 102) even though the server logged 200. `rsbuild dev` always
    // sends a length — mirror it.
    const stat = fs.statSync(filePath)
    res.writeHead(200, {
      ...cors,
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': stat.size,
    })
    const stream = fs.createReadStream(filePath)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  })
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => resolve({ server, state, waiters }))
  })
}

function waitFor(waiters, kind, timeoutMs, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${what} (${timeoutMs}ms)`)), timeoutMs)
    const arr = kind === 'final' ? waiters.final : waiters.heartbeat
    arr.push((payload) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

async function main() {
  const serial = pickSerial(args.serial)
  const ip = lanIp()
  const label = args.label || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  // Per-run copies only on explicit intent (--label/--stamp); default runs
  // keep a single living record per arm (device-selftest-latest.* /
  // device-selftest-ifr-latest.*), so acceptance runs of both arms coexist.
  const stamped = Boolean(args.label || args.stamp)
  const latest = args.ifr ? 'device-selftest-ifr-latest' : 'device-selftest-latest'
  console.log(`[device] serial=${serial} lan=${ip}:${PORT} label=${label}`)

  const model = adb(serial, ['shell', 'getprop', 'ro.product.model']).trim()
  const sdk = adb(serial, ['shell', 'getprop', 'ro.build.version.sdk']).trim()
  console.log(`[device] model=${model} sdk=${sdk}`)

  // Tap capability probe (MIUI INJECT_EVENTS gate).
  const tapProbe = adb(serial, ['shell', 'input', 'tap', '1', '1'], { allowFail: true })
  const tapCapable = !tapProbe.includes('SecurityException') && !tapProbe.includes('INJECT_EVENTS')
  console.log(`[device] input injection: ${tapCapable ? 'OK' : 'BLOCKED (manual tap mode)'}`)

  if (!args['no-build']) {
    console.log('[device] building device-lab…')
    execSync('nub run -F @lynx-solid/dev-device-lab build', {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        DEVICE_REPORT_URL: `http://${ip}:${PORT}/report`,
        DEVICE_TAP_WAIT_MS: String(TAP_WAIT),
        ...(args.ifr ? { LYNX_MT_IFR: '1' } : {}),
      },
    })
  }
  if (!fs.existsSync(path.join(distDir, 'selftest.lynx.bundle')))
    throw new Error(`missing bundle: ${path.join(distDir, 'selftest.lynx.bundle')}`)

  const { server, state, waiters } = await startServer(PORT, ip)

  // Wake/unlock before the first launch: `withScreenAwake` only keeps an
  // already-on screen on, and a secure lock cannot be bypassed over adb.
  // Screen timeout is raised for this run only — see harness/keep-awake.mjs.
  withScreenAwake({ adb: (argv, opts) => adb(serial, argv, opts), minutes: KEEP_AWAKE_MIN, label: 'device' })
  const wake = await wakeDevice({ adb: (argv, opts) => adb(serial, argv, opts), label: 'device' })
  if (!wake.awake || wake.keyguard) {
    throw new Error(wake.keyguard
      ? 'keyguard is showing — unlock the phone and rerun (adb cannot bypass a secure lock)'
      : 'screen did not wake — wake the phone and rerun')
  }

  // Cold start: Explorer reset, then open via the DebugBridge intent.
  adb(serial, ['shell', 'am', 'force-stop', 'com.lynx.explorer'], { allowFail: true })

  const bundleUrl = `http://${ip}:${PORT}/selftest.lynx.bundle`
  // Unique query per run: Explorer disk-caches bundles by URL, and a stale
  // cache of a once-broken build survives force-stop (the fixed build never
  // gets fetched). The server ignores the query string.
  const openUri = `lynx://open?url=${encodeURIComponent(`${bundleUrl}?cb=${Date.now()}`)}`
  const openAt = Date.now()
  adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', openUri])
  console.log(`[device] opened ${bundleUrl}`)

  try {
    const heartbeat = state.heartbeat
      ?? await waitFor(waiters, 'heartbeat', 90_000, 'heartbeat (open → first content)')
    const openToContentMs = state.heartbeatAt - openAt
    console.log(`[device] heartbeat renderedMs=${heartbeat.renderedMs?.toFixed?.(1) ?? heartbeat.renderedMs} (open→content ${openToContentMs}ms)`)

    // Tap phase for the sign-event case.
    if (TAP_WAIT > 0) {
      if (tapCapable && TAP_X !== null && TAP_Y !== null) {
        // The heartbeat marks BG flush done, but the first frame lands a
        // beat later — tapping immediately hits empty air. Wait for paint,
        // then tap with retries until the final report arrives.
        const deadline = Date.now() + TAP_WAIT
        let attempt = 0
        while (!state.final && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, attempt === 0 ? 1000 : 2000))
          if (state.final)
            break
          attempt++
          console.log(`[device] tapping (${TAP_X}, ${TAP_Y}) attempt ${attempt}…`)
          adb(serial, ['shell', 'input', 'tap', String(TAP_X), String(TAP_Y)], { allowFail: true })
        }
      }
      else {
        console.log('[device] please tap the "TAP ME" button on the phone (adb input is blocked by MIUI permissions, so this must be done manually)…')
      }
    }

    const final = state.final
      ?? await waitFor(waiters, 'final', TAP_WAIT + 60_000, 'final report')
    const contentToFinalMs = Date.now() - openAt

    // Screenshot for the visual record.
    fs.mkdirSync(resultsDir, { recursive: true })
    const png = path.join(resultsDir, stamped ? `device-selftest-${label}.png` : `${latest}.png`)
    try {
      const shot = spawnSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 30_000 })
      if (shot.status === 0 && shot.stdout)
        fs.writeFileSync(png, shot.stdout)
    }
    catch {}

    if (!args['keep-open'])
      adb(serial, ['shell', 'am', 'force-stop', 'com.lynx.explorer'], { allowFail: true })

    const cases = final.cases ?? []
    const failed = cases.filter(c => c.pass === false)
    const skipped = cases.filter(c => c.pass === null)

    const result = {
      meta: {
        date: new Date().toISOString(),
        serial,
        model,
        sdk,
        label,
        bundleUrl,
        tapCapable,
        tapWaitMs: TAP_WAIT,
        openToContentMs,
        openToFinalMs: contentToFinalMs,
        renderedMs: heartbeat.renderedMs,
        host: `${os.cpus().length}× ${os.cpus()[0]?.model ?? '?'}`,
      },
      cases,
    }
    const stem = `device-selftest-${label}`
    if (stamped) {
      fs.writeFileSync(path.join(resultsDir, `${stem}.json`), `${JSON.stringify(result, null, 2)}
`)
    }
    fs.writeFileSync(path.join(resultsDir, `${latest}.json`), `${JSON.stringify(result, null, 2)}
`)

    let md = `# Device selftest — ${model} (Android SDK ${sdk})\n\n`
    md += `- date: ${result.meta.date}\n- label: ${label}\n- bundle: \`${bundleUrl}\`\n`
    md += `- open → content (heartbeat): **${openToContentMs} ms** (explorer cold start + LAN fetch + BG eval + render + IPC apply)\n`
    md += `- page-internal rendered mark: ${heartbeat.renderedMs} ms (BG module eval → mount settled)\n`
    md += `- adb input injection: ${tapCapable ? 'available' : 'BLOCKED by MIUI (manual tap)'}\n\n`
    md += `| case | result | detail | ms |\n|---|---|---|---|\n`
    for (const c of cases) {
      const r = c.pass === false ? 'FAIL' : c.pass === null ? 'SKIP' : 'PASS'
      md += `| ${c.name} | ${r} | ${String(c.detail).replace(/\|/g, '/')} | ${c.ms.toFixed(0)} |\n`
    }
    md += `\n${failed.length} failed, ${skipped.length} skipped, ${cases.length - failed.length - skipped.length} passed.\n`
    fs.writeFileSync(path.join(resultsDir, `${latest}.md`), md)
    if (stamped)
      fs.writeFileSync(path.join(resultsDir, `${stem}.md`), md)
    console.log(`\n${md}`)
    console.log(`[device] wrote results/${latest}.{json,md,png}${stamped ? ` + ${stem}.{json,md,png}` : ''}`)
    server.close()
    process.exit(failed.length > 0 ? 1 : 0)
  }
  catch (err) {
    console.error('[device] FAILED:', err.message)
    // Surface the device-side JS/engine errors for this attempt.
    try {
      const log = adb(serial, ['logcat', '-d', '-t', '600'], { allowFail: true })
      const interesting = log
        .split('\n')
        .filter(l => /JS ERROR|JS:|lynx|Lepus|Exception|AndroidRuntime|template|bundle/i.test(l))
        .slice(-40)
      if (interesting.length) {
        console.error('[device] logcat (filtered, last 40):')
        for (const l of interesting)
          console.error(`  ${l}`)
      }
      else {
        console.error('[device] logcat: nothing relevant in last 600 lines')
      }
    }
    catch {}
    // Last-ditch screenshot to see what the screen actually showed.
    try {
      fs.mkdirSync(resultsDir, { recursive: true })
      const shot = spawnSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 30_000 })
      if (shot.status === 0 && shot.stdout) {
        const failName = stamped ? `device-selftest-${label}-FAIL.png` : `${latest}-FAIL.png`
        fs.writeFileSync(path.join(resultsDir, failName), shot.stdout)
      }
    }
    catch {}
    server.close()
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
