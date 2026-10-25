/**
 * Rig self-check — no device needed. Run:
 *   node packages/benchmark/harness/rep-window.selftest.mjs
 *   nub run -F @lynx-solid/benchmark selftest
 *
 * The tracker-driven case is the one that produced wrong numbers: Android 10
 * denies `logcat -c`, so the previous rep's markers were still in the buffer and
 * the tracker took the FIRST process start it saw. The fixture uses the REAL
 * line shapes captured from the device (BKL-AL20, Android 10) — `-v epoch`
 * prefix, events-buffer `am_proc_start: [0,pid,tid,com.lynx.explorer,…]`,
 * `layout finish … Time taken: N ns`.
 *
 * The last block is the policy half: which reasons are a rig failure (warn) and
 * which are a dead launch (retry). The driver used to get one wrong — it did not
 * retry a swallowed launch, silently losing samples for whichever arm ran first.
 *
 * The tracker block in the middle is the completion rule itself. It is tested
 * here because that rule has been wrong twice on a device: once accepting the
 * empty page as content, and once making the SAME arm in the SAME window answer
 * two different numbers depending on when the log happened to be read.
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { anchorIndex, classify, isDeadLaunch, isRigFailure } from './rep-window.mjs'

import { createTracker } from './tracker.mjs'

let failed = 0
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) {
    failed++
    console.log(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`)
  }
  else { console.log(`✓ ${name}`) }
}

const proc = t => `${t}  1731  1785 I am_proc_start: [0,11176,10231,com.lynx.explorer,activity,{com.lynx.explorer/com.lynx.explorer.DebugBridgeActivity}]`
const shell = t => `${t} 11176 11176 I lynx    : [7CAAD650D0:INFO:lynx_shell.cc(147)] LynxShell create, this:0x0000007BA934BF00`
const ready = t => `${t} 11176 11221 I lynx    : [7BA80F2D50:INFO:bts_runtime.cc(985)] lynx runtime ready`
const layout = (t, ns) => `${t} 11176 11176 I lynx    : [7CAAD650D0:INFO:layout_context.cc(882)] [Layout] layout finish with result size: 1080, 1920 for viewport, size: 1080.0, 1920.0; mode: 1, 1 Time taken: ${ns} ns`

const staleRep = [proc(1792308098.100), shell(1792308098.300), ready(1792308098.900), layout(1792308099.400, 212983854)]
const thisRep = [proc(1792308099.507), shell(1792308099.705), ready(1792308100.291), layout(1792308100.734, 212983854)]
const buf = [...staleRep, ...thisRep]

eq('anchor points at the NEWEST process start', anchorIndex(buf), 4)
eq('no process start → -1 (caller ingests nothing)', anchorIndex([shell(1.0)]), -1)

{
  const t = createTracker()
  for (const l of buf.slice(anchorIndex(buf)))
    t.ingest(l)
  const r = t.decide(Date.now() + 1)
  eq('anchored ingest sees ONLY this rep, on real line shapes', { proc: t.state.proc, ready: t.state.ready !== undefined, contentT: r?.contentT, layouts: t.state.layouts.length }, { proc: 1792308099.507, ready: true, contentT: 1792308100.734, layouts: 1 })
}

const base = { proc: 200, shell: 200.2, ready: 200.9, layouts: 1 }
eq('full markers → a measurement', classify({ ...base, resolution: { contentT: 201.5, tier: 1, layoutCount: 1 } }), { proc2first: 1500, shell2first: 1300, tier: 1, layouts: 1, preReady: false })
eq('am start failed → launch-error', classify({ proc: undefined, startOut: 'Error: Activity not started' }), { reason: 'launch-error' })
eq('no process start → classified, never dropped', classify({ proc: undefined, startOut: 'Starting: Intent { … }' }), { reason: 'missing: am_proc_start' })
eq('no frame and no shell → names the missing marker', classify({ ...base, shell: undefined, resolution: undefined }), { reason: 'missing: LynxShell create' })
eq('no frame, shell present, no `ready` → names the missing marker', classify({ ...base, ready: undefined, resolution: undefined }), { reason: 'missing: lynx runtime ready' })
eq('ready but no content-quality layout before the cap', classify({ ...base, resolution: undefined }), { reason: 'cap-exceeded', layouts: 1 })
eq('content before the process start → stale-buffer, not a number', classify({ proc: 200, shell: 200.1, ready: 200.5, resolution: { contentT: 199, tier: 1, layoutCount: 1 }, layouts: 1 }), { reason: 'stale-buffer', proc2first: -1000 })
// No process appeared, so every line in the window is somebody else's: a stale
// anchor plus a stale frame would otherwise produce a plausible number for a
// launch that never happened. That hole is why `pidSeen` outranks a resolution.
eq('no process at all → missing: am_proc_start, even with a frame in the window', classify({ proc: 200, pidSeen: false, shell: 200.2, ready: 200.9, resolution: { contentT: 201.5, tier: 1, layoutCount: 1 }, layouts: 1 }), { reason: 'missing: am_proc_start' })
// The EMUI/iAware case measured on the 2017 phone: the process IS forked and is
// killed ~3 ms later, so the app never logs a line. The only trace is the kill
// record itself — the verdict has to name the killer, because "no process" is
// false and "missing shell" blames the engine.
const iAwareKill = '1792431362.649  1691  2256 I am_kill : [0,14987,com.lynx.explorer,-10000,stop com.lynx.explorerfrom pid 1691 iAwareF[CrashClean] 9877579ms]'
eq('a host kill right after our own process start → names the killer', classify({ proc: 200, pidSeen: false, kill: iAwareKill, resolution: undefined, layouts: 0 }), { reason: 'host-killed: iAwareF[CrashClean]' })
eq('an unknown killer is quoted verbatim, not flattened to "host"', classify({ proc: 200, pidSeen: false, kill: 'x am_kill : [0,14987,com.lynx.explorer,-10000,some vendor reason]', resolution: undefined, layouts: 0 }), { reason: 'host-killed: some vendor reason' })
eq('a healthy launch keeps its measurement when pidSeen is true', classify({ ...base, pidSeen: true, resolution: { contentT: 201.5, tier: 1, layoutCount: 1 } }), { proc2first: 1500, shell2first: 1300, tier: 1, layouts: 1, preReady: false })
// A frame is a frame: the two markers are DIAGNOSTICS, logged before the frame,
// so they are the first lines to roll out of a small `main` ring buffer. Both of
// these cases used to be scored as dead launches and thrown away (18 real frames
// were lost to the `shell` one in a single session on the 2017 phone).
eq('a frame WITHOUT a shell marker is still a measurement', classify({ ...base, shell: undefined, resolution: { contentT: 201.5, tier: 1, layoutCount: 1 } }), { proc2first: 1500, shell2first: null, tier: 1, layouts: 1, preReady: false })
eq('a frame without `ready` is a measurement, and says so instead of guessing', classify({ ...base, ready: undefined, resolution: { contentT: 201.0, tier: 1, layoutCount: 2 } }), { proc2first: 1000, shell2first: 800, tier: 1, layouts: 2, preReady: null })
eq('a frame with neither marker is still a measurement', classify({ ...base, shell: undefined, ready: undefined, resolution: { contentT: 201.5, tier: 1, layoutCount: 1 } }), { proc2first: 1500, shell2first: null, tier: 1, layouts: 1, preReady: null })
eq('a frame before `ready` is marked, not re-scored', classify({ ...base, resolution: { contentT: 200.5, tier: 1, layoutCount: 2 } }), { proc2first: 500, shell2first: 300, tier: 1, layouts: 2, preReady: true })

// --- the completion rule: content, never the empty page, and never a re-layout
// Measured bands (ms): empty page 0.88-1.00 on the old phone, 0.03-0.44 on the
// flagship; content 4.70-12.3 and 2.18-2.84. The floor is 1.5: above the empty
// page on both devices and below the content on both.
const k80 = [
  proc(1792308099.000),
  shell(1792308099.089),
  layout(1792308099.090, 444375), // 0.44 ms — the empty page
  layout(1792308099.151, 2334427), // 2.334 ms — the MT's own paint, BEFORE ready
]
{
  const t = createTracker()
  for (const l of k80)
    t.ingest(l)
  eq('K80, read before `ready` is in the buffer → the 2.334 ms frame wins', t.decide(0)?.contentT, 1792308099.151)
}
{
  // The regression that removed the `ready` door: read the SAME window again once
  // `ready` and a post-ready re-layout have landed. It used to answer with the
  // re-layout instead (190 ms instead of 150 ms on the device).
  const t = createTracker()
  for (const l of [...k80, ready(1792308099.159), layout(1792308099.190, 2580000)])
    t.ingest(l)
  eq('…and read after `ready` → the SAME first frame, not the re-layout', t.decide(0)?.contentT, 1792308099.151)
}
{
  // The stream variant of the same trap, and the reason `decide` refuses to answer
  // without an anchor: a rep that has not seen its own `am_proc_start` yet may
  // already hold a frame — the PREVIOUS rep's, arriving a few hundred ms late. It
  // used to resolve there, end the rep ~900 ms in, and report a launch that had
  // painted as `missing: am_proc_start` (observed twice in 33 launches).
  const t = createTracker()
  t.ingest(layout(1792308099.900, 2334427))
  eq('a frame with no process start yet resolves to nothing', t.decide(0), null)
}
{
  const t = createTracker()
  for (const l of [proc(1792308099.000), shell(1792308099.089), layout(1792308099.090, 444375)])
    t.ingest(l)
  eq('only the empty page → no verdict yet (keep polling)', t.decide(0), null)
}
{
  const t = createTracker()
  for (const l of [proc(1792308099.000), shell(1792308099.089), layout(1792308099.090, 880000), layout(1792308099.354, 4700000), ready(1792308099.363)])
    t.ingest(l)
  eq('BKL small screen: the 4.7 ms frame, pre-ready, is the number', t.decide(0)?.contentT, 1792308099.354)
}
{
  // A layout the engine did not time cannot be judged by the floor, so it only
  // counts once the runtime is up — an unlabelled empty page must not win.
  const untimed = t => `${t} 11176 11176 I lynx    : [7CAAD650D0:INFO:layout_context.cc(882)] [Layout] layout finish with result size: 1080, 1920 for viewport`
  const beforeReadyOnly = createTracker()
  for (const l of [proc(1792308099.000), untimed(1792308099.100)])
    beforeReadyOnly.ingest(l)
  eq('an untimed layout before `ready` is not content', beforeReadyOnly.decide(0), null)
  const afterReady = createTracker()
  for (const l of [proc(1792308099.000), ready(1792308099.120), untimed(1792308099.130)])
    afterReady.ingest(l)
  eq('the same layout after `ready` resolves as tier 2', afterReady.decide(0)?.contentT, 1792308099.130)
}
{
  // `logcat -b events,main` prints the two buffers as GROUPED sections, not as one
  // merged stream, so the window after the anchor also carries the whole `main`
  // section — frames from earlier launches, older than `proc` but appearing later
  // in file order. One of those must not become the answer (it would then be
  // rejected as `stale-buffer`, losing a real rep to a logging-layout accident).
  const t = createTracker()
  for (const l of [
    layout(1792308099.900, 3000000), // an earlier launch's frame, in file order first
    proc(1792308100.000), // the anchor: newest `am_proc_start`
    layout(1792308100.320, 5000000), // this launch's content frame
  ])
    t.ingest(l)
  eq('a frame older than the process start cannot win', t.decide(0)?.contentT, 1792308100.320)
}
{
  // The kill that ended the "dead launch" investigation: `am_proc_start` then, 3 ms
  // later, `am_kill ... iAwareF[CrashClean]`. The tracker keeps that line because it
  // is the only evidence the host (not the engine) ended the launch.
  const t = createTracker()
  for (const l of [
    proc(1792431362.646),
    '1792431362.649  1691  2256 I am_kill : [0,14987,com.lynx.explorer,-10000,stop com.lynx.explorerfrom pid 1691 iAwareF[CrashClean] 9877579ms]',
  ])
    t.ingest(l)
  eq('the kill record is kept, with the killer in it', t.state.kill?.includes('iAwareF[CrashClean]'), true)
}

// --- policy: warn / retry ----------------------------------------------------
// Every class in the taxonomy is the rig failing to measure; a resolved rep is a
// measurement and is never announced as a failure.
eq('a measurement is not a rig failure', isRigFailure(undefined), false)
for (const r of ['launch-error', 'missing: am_proc_start', 'missing: LynxShell create', 'missing: lynx runtime ready', 'cap-exceeded', 'stale-buffer'])
  eq(`"${r}" is a rig failure (warn)`, isRigFailure(r), true)

// Only launches that never produced a window are re-issued: `missing: LynxShell
// create` is included (AMS swallows the launch and `am start -W` prints no
// TotalTime), which is the case the driver used to drop.
for (const r of ['launch-error', 'missing: am_proc_start', 'missing: LynxShell create'])
  eq(`"${r}" is a dead launch (retry)`, isDeadLaunch(r), true)
for (const r of [undefined, 'missing: lynx runtime ready', 'cap-exceeded', 'stale-buffer'])
  eq(`"${r}" must NOT be retried`, isDeadLaunch(r), false)

// The rig's remaining deliberate wait, frozen.
//
// A default is the ONLY path anyone watches, while a flag is what the author
// measures — so "we made it faster" has to mean the default moved, not that a flag
// exists. The transport no longer has waits to tune (it resolves on the arriving
// line), which leaves `gap`; freezing it here means changing it costs an
// intentional edit to this test, which is the point: it must be argued, not
// drifted into.
const driver = readFileSync(new URL('./ab-device.mjs', import.meta.url), 'utf8')
for (const [name, ms] of [['gap', 0]]) {
  const opt = new RegExp(`'${name}': \\{ type: 'string', default: '${ms}' \\}`)
  eq(`default --${name} is ${ms}ms (see the note in ab-device.mjs)`, opt.test(driver), true)
}

console.log(failed === 0 ? '\nrig self-check: all green' : `\nrig self-check: ${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
