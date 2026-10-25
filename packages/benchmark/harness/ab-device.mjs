/**
 * Interleaved on-device A/B — THE device driver.
 *
 * This is the only script that launches the app and turns logcat into a
 * number. It used to be one of six near-copies (`cold-start.mjs`,
 * `launch.mjs`, `phase-split.mjs`, `sweep-rows-react.mjs` and the
 * `launch-soak.mjs` diagnostic all re-implemented launch + window + verdict),
 * and only this copy received the fixes, so the same screen produced different
 * numbers depending on which script was run. They are deleted; what they were
 * for is now a flag here (`--phases`) or a thin orchestrator that calls this
 * one (`sweep-rows.mjs`, which only builds bundles and aggregates the `--json`
 * output below).
 *
 * Why interleave at all: running one app to completion and then the other lets
 * a thermal or background-load drift between the two halves land directly in
 * the comparison. At n=5 with a 15-30% spread per rep that is enough to move a
 * "crossover" by hundreds of rows. So: one rep of A, one of B, repeat — every
 * point is measured in the same window.
 *
 * Completion detection lives in `tracker.mjs` and the verdict taxonomy in
 * `rep-window.mjs` (both unit-tested without a device by
 * `rep-window.selftest.mjs`, `nub run -F @lynx-solid/benchmark selftest`). It is
 * NOT a fixed wait and NOT a quiet window: it stops the instant a content frame
 * is recognised — the first `layout finish` at or after `lynx runtime ready`
 * whose `Time taken` is at least 1 ms.
 *
 * Judgement rule, fixed in advance so the numbers cannot be read generously:
 *   |Δ| < 15 ms                                  -> within noise
 *   |Δ| >= 25 ms and the two IQRs do not overlap -> a win
 *   otherwise                                    -> trend, not significant
 *
 * Launch accounting (`oneRep`): the lines come from ONE `adb logcat` stream held
 * for the whole run, so a rep costs nothing beyond waiting for its own lines —
 * the pull transport (`logcat -d` per poll) charged ~185 ms per call whatever it
 * asked for, and reading during the boot also slowed the app being measured. A
 * launch that still yields no verdict is CLASSIFIED (`launch-error`, `missing: …`,
 * `cap-exceeded`, `stale-buffer`, `host-killed: …`) and counted in the tally
 * instead of being dropped: the medians above are computed on valid reps, so a
 * silent drop takes the slow tail with it. A dead launch is re-issued. Every class
 * here is the rig failing to measure: a resolved rep is never announced as a
 * failure, whatever side of `lynx runtime ready` its frame fell on.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { wakeDevice, withScreenAwake } from './keep-awake.mjs'
import { anchorIndex, classify, isDeadLaunch, isRigFailure } from './rep-window.mjs'
import { createTracker } from './tracker.mjs'

const { values: a } = parseArgs({
  options: {
    'serial': { type: 'string', default: '' },
    'label': { type: 'string', default: 'point' },
    'a-url': { type: 'string', default: '' },
    'a-bundle': { type: 'string', default: '' },
    'b-url': { type: 'string', default: '' },
    'b-bundle': { type: 'string', default: '' },
    'a-name': { type: 'string', default: 'A' },
    'b-name': { type: 'string', default: 'B' },
    // A third arm: measured in the SAME window (A, B, C per rep), so every
    // pairwise Δ is same-window and the absolute medians stay comparable.
    // React's IFR is always on, so it is a plain third arm, not a variant of ours.
    'c-url': { type: 'string', default: '' },
    'c-bundle': { type: 'string', default: '' },
    'c-name': { type: 'string', default: 'C' },
    'reps': { type: 'string', default: '11' },
    // Upper bound for how long this run may keep the screen awake, in minutes.
    // The setting is persistent (survives reboots), so it is bounded rather
    // than "never" — a SIGKILL that skips the restore still expires by itself.
    'keep-awake-min': { type: 'string', default: '60' },
    // Waiting budget for one launch: give up well after the slowest observed good
    // boot. Nothing here is a fixed wait — the driver resolves on the line that
    // arrives (see `createLogStream`), so this bound is only reached by a launch
    // that never paints.
    'cap': { type: 'string', default: '12000' },
    // Bound on "this launch never logged its own process start at all" (warm
    // start, or the app failed to come up). Without it a dead attempt burns the
    // whole `cap`, which dominates a run's wall clock on a slow device. The fork
    // event lands within a few hundred ms of `am start`; the content FRAME is not
    // bounded here, because at 1000 rows it legitimately takes seconds.
    'launchTimeout': { type: 'string', default: '3000' },
    // Quiet time between reps, i.e. before the next `am start`. It was 1200 ms
    // because back-to-back launches on the 2017 phone are sometimes never forked by
    // AMS at all, which — when a swallowed launch meant a LOST sample — was worth
    // paying for. That justification retired with the hole: a swallowed launch is
    // named by the host, abandoned in ~7 s and re-issued, and the rate no longer
    // separates the settings (`--gap 0` lost 7/231 launches, 3.0 %, `--gap 1200`
    // 9/273, 3.3 %). So the default is the cheaper value; `--gap 1200` is the
    // safety margin to reach for if a device swallows launches more often.
    'gap': { type: 'string', default: '0' },
    // Re-issues for a launch AMS swallowed (see `attempt`). Measured on the
    // 2017 phone over 296 launches: 13.2 % swallowed, one re-issue rescues
    // ~78 % of them, which still lost 2.7 % of reps; a second takes the expected
    // residual below 1 % and costs ~4.5 s per use there.
    'retries': { type: 'string', default: '2' },
    // Anchor guard: `--expect=-307±60` — after the A/B, fail (exit 2) when the
    // measured Δ leaves this band. Catches a rig that silently measures the same
    // bundle twice (a flag that did not apply) instead of after a whole sweep.
    'expect': { type: 'string', default: '' },
    // Print each rep's marker timeline (process start → shell → LoadTemplate →
    // runtime ready → content frame). This is the `--phases` view the deleted
    // `phase-split.mjs` / `cold-start.mjs` used to provide, from the same data
    // the verdict is computed from — so the phases can never disagree with the
    // number they explain.
    'phases': { type: 'boolean', default: false },
    // Machine-readable per-rep records + summary, so an orchestrator (or a
    // second reader) does not have to re-parse stdout.
    'json': { type: 'string', default: '' },
  },
})

const adbArgs = a.serial ? ['-s', a.serial] : []
const KEEP_AWAKE_MIN = Number(a['keep-awake-min'])

function adb(argv, { allowFail = false, timeout = 60_000 } = {}) {
  const { out, status } = adbTimed(argv, { timeout })
  if (!allowFail && status !== 0)
    throw new Error(`adb ${argv.join(' ')} -> ${out.slice(0, 160)}`)
  return out
}

/**
 * Same call, but also reports whether the timeout killed it. For a dead launch
 * that is the whole diagnosis: "`am start` printed an error and returned" and
 * "`am start` never returned until the bound fired" are different bugs, and
 * `adb()` alone cannot tell them apart (both give output without `TotalTime`).
 */
function adbTimed(argv, { timeout = 60_000 } = {}) {
  const r = spawnSync('adb', [...adbArgs, ...argv], {
    encoding: 'utf8',
    timeout,
    maxBuffer: 128 * 1024 * 1024,
  })
  return {
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    status: r.status,
    timedOut: r.error?.code === 'ETIMEDOUT' || (r.signal !== null && r.signal !== undefined),
  }
}

const sleep = ms => new Promise(x => setTimeout(x, ms))

/**
 * The streaming transport: ONE `adb logcat` for the whole driver run.
 *
 * Pulling (`logcat -d`) costs ~185 ms per call no matter how little it asks for —
 * measured on the 2017 phone over WiFi: `-t 300` 188 ms, `-t 1500` 232 ms,
 * `-t 3000` 347 ms — and a rep pulls 1-5 times, so the transport was 20-50 % of a
 * rep and the only thing `settle` / `interval` were tuning. A stream ships each
 * line once, so a rep pays nothing beyond waiting for the lines it needs, and it
 * stops loading the device exactly while the app boots — a load that MOVES the
 * number (a 250 ms pull cadence measured +48…+115 ms at 1000 rows).
 *
 * The tracker already has the right shape for this (`ingest` is idempotent and
 * `decide` resolves the instant a content frame is in), so the verdict logic does
 * not change at all — only where the lines come from. `mark()` is taken BEFORE
 * the launch, so a rep's window cannot miss a line; the previous rep's lines are
 * behind the mark, and `decide` still drops layouts older than this `proc_start`.
 */
function createLogStream() {
  // Kept as a ring: a rep is a few hundred lines, so 20k is ~30 s of a busy
  // device — deep enough that a `mark` is never evicted mid-rep.
  const MAX = 20_000
  let child = null
  let pending = ''
  let lines = []
  let base = 0
  let stopped = false
  let resume = null
  let restarts = 0

  const wake = () => {
    const r = resume
    resume = null
    if (r)
      r()
  }

  function openStream() {
    // `-T 20`: start with the last 20 lines, not the whole ring. A streaming
    // `logcat` first replays what the buffers already hold — 10 915 lines in the
    // first prototype run, including an `am_proc_start` from a launch 15 minutes
    // earlier, which the first rep then anchored on and reported as 904 646 ms.
    // The guard is two-sided: replay only 20 lines, and `caughtUp()` below refuses
    // to start measuring until the stream's own clock has reached now.
    child = spawn('adb', [...adbArgs, 'logcat', '-b', 'events,main', '-v', 'epoch', '-T', '20'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      pending += chunk
      let cut = pending.indexOf('\n')
      while (cut >= 0) {
        lines.push(pending.slice(0, cut).replace(/\r$/, ''))
        pending = pending.slice(cut + 1)
        cut = pending.indexOf('\n')
      }
      if (lines.length > MAX) {
        const drop = lines.length - MAX
        lines = lines.slice(drop)
        base += drop
      }
      wake()
    })
    child.on('error', () => {})
    child.on('exit', () => {
      if (stopped)
        return
      // Reopen rather than abort a sweep. Lines in flight during the gap are gone,
      // and the rep holding them cannot resolve: it will fail on its own missing
      // anchor (`missing: am_proc_start`) and be re-issued. That is the one
      // guarantee this transport must keep — a stall may cost a re-issue, never a
      // silent `null`.
      restarts += 1
      setTimeout(openStream, 250)
    })
  }

  openStream()

  return {
    /** Absolute index of the next line to arrive. */
    mark: () => base + lines.length,
    /** Everything at or after `mark`, plus where to resume. */
    drain(mark) {
      const from = Math.max(0, mark - base)
      return { lines: lines.slice(from), next: base + lines.length }
    },
    /** Resolves when a line arrives, or after `ms` — a local tick, no adb call. */
    wait(ms) {
      return new Promise((resolve) => {
        let settled = false
        let timer = 0
        const finish = () => {
          if (settled)
            return
          settled = true
          resume = null
          clearTimeout(timer)
          resolve()
        }
        timer = setTimeout(finish, ms)
        resume = finish
      })
    },
    /**
     * Is the stream's own clock inside the last 3 s? A replay, a stalled link or a
     * dead child all look like "lines are arriving" — this is what tells them
     * apart from a stream that is actually current. Without it the first rep can
     * anchor on a replayed `am_proc_start` and report a plausible-looking wrong
     * number (measured once: 904 646 ms).
     *
     * The leading whitespace is part of the format: `-v epoch` right-aligns the
     * timestamp, so `^\\d` matches nothing and every line reads as "not current".
     */
    caughtUp() {
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = /^\s*(\d{10,13}(?:\.\d{1,9})?)/.exec(lines[i])
        if (!m)
          continue
        return Date.now() / 1000 - Number(m[1]) < 3
      }
      return false
    },
    /** Forget everything buffered so far (used once, after the stream caught up). */
    discard() {
      base += lines.length
      lines = []
    },
    /** Total lines delivered since start (the buffer's absolute end). */
    seen: () => base + lines.length,
    restarts: () => restarts,
    stop() {
      stopped = true
      child?.kill()
    },
  }
}

/** The transport: one stream per run, feeding every rep's tracker. */
const stream = createLogStream()

function hashedUrl(url, bundle) {
  const h = createHash('sha256').update(fs.readFileSync(bundle)).digest('hex').slice(0, 12)
  return `${url}?v=${h}`
}

/**
 * One launch → either a measurement or a NAMED failure. Never `null`: a rep
 * that is silently dropped takes the slow tail with it, and the two arms may
 * have different tails, which biases the median in a way no IQR shows.
 */
async function oneRep(url) {
  const tStart = Date.now()
  // The 2017 phone's `am start` sometimes silently does nothing: `-W` returns in
  // ~300 ms, no process appears and neither log buffer gets a single line. A
  // quiet gap between reps plus one retry is the only reliable counter-measure
  // found; `am start -S` made it worse (it killed the app mid-boot).
  adb(['shell', 'am', 'force-stop', 'com.lynx.explorer'], { allowFail: true })
  for (let i = 0; i < 12; i++) {
    if (!adb(['shell', 'pidof', 'com.lynx.explorer'], { allowFail: true }).trim())
      break
    await sleep(150)
  }
  // No `logcat -c`: Android 10 denies it, and measured on this device it also
  // makes the *following* launch invisible for a while — 4/8 "failures" with the
  // clear against 20/20 clean launches without it. `anchorIndex` isolates a rep
  // by the newest process start instead, which needs no clear at all.
  // Was the previous process actually gone before we launch? A warm start does
  // not write `am_proc_start`, which is exactly the "missing" case.
  const pidAlive = adb(['shell', 'pidof', 'com.lynx.explorer'], { allowFail: true }).trim() !== ''
  // Host-side phase marks. The measured number is a DEVICE timestamp, so none of
  // this biases it — it exists because "each rep takes 4 s" is not an answer: the
  // question is which of the waits the rig imposes, and none of them is visible
  // from the device timeline. Every mark is a `Date.now()` capture, no extra adb.
  const tTeardown = Date.now()
  if (Number(a.gap))
    await sleep(Number(a.gap))
  const tGap = Date.now()
  // Remember where the stream stands BEFORE the launch. The force-stop above
  // guarantees the previous process is gone, so every `am_proc_start` after this
  // mark belongs to this rep — and no line of the boot can be missed by arriving
  // "too early", which is what a pull loop could only approximate.
  let mark = stream.mark()

  // `-W`: block until the activity is actually launched. On the 2017 phone a
  // cold start takes multiple seconds, and guessing with a fixed no-launch
  // timeout turned slow starts into "missing: am_proc_start" (pidAlive=false,
  // launchTime=false — i.e. the launch had not completed yet).
  // 4 s is ~10x a healthy launch (measured 300-450 ms on both devices), and it is
  // only ever reached by a launch that never comes up: every timeout observed in
  // this rig (all ~20 of them) was an EMUI/iAware kill, i.e. a rep that cannot be
  // measured anyway. So the bound is tight: 8 s bought nothing and doubled the
  // cost of a dead launch. `am` never returns on its own in the vendor-stall case
  // (task created, `taskCount = 0`), so the retry handles it either way.
  const startRun = adbTimed(['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `lynx://open?url=${encodeURIComponent(url)}`], { timeout: 4_000 })
  const start = startRun.out
  const tLaunch = Date.now()
  // `-W` prints the device's own launch latency; on the 2017 phone a launch AMS
  // never performs makes it block until this bound expires, and then it prints no
  // `TotalTime` at all. That absence is information: with no process either, the
  // launch is known to be dead, so the rig skips the whole cap below instead of
  // paying ~20 s for a rep it cannot measure.
  const launchTotalMs = Number(/TotalTime: (\d+)/.exec(start)?.[1] ?? Number.NaN)
  const stalledLaunch = !Number.isFinite(launchTotalMs)
  // `-W` returns when the activity is displayed, but on the 2017 phone `pidof`
  // can stay empty for a moment after that. Checking once produced "no process"
  // verdicts for launches that were merely not visible yet (bisected: 4/8 with
  // the early check, 20/20 once the check waits). A stalled launch gets a shorter
  // budget because the process, if there is one, already exists by then.
  let pid = ''
  for (let i = 0; i < (stalledLaunch ? 8 : 25) && !pid; i++) {
    pid = adb(['shell', 'pidof', 'com.lynx.explorer'], { allowFail: true }).trim()
    if (!pid)
      await sleep(200)
  }

  const tPidPolled = Date.now()
  // Did a process actually appear? This needs no log parsing and no clock
  // comparison: `pidof` was empty before the launch (checked above), so if it is
  // still empty, AMS never forked the app. That is the failure the 2017 phone
  // produces in ~3 % of launches, and it is now named by the host rather than
  // inferred from a missing log line.
  const pidSeen = pid !== ''
  const deadOnArrival = stalledLaunch && !pidSeen

  const tracker = createTracker()
  // Nothing is slept here. The lines arrive on their own and `decide` resolves on
  // the one that matters, so there is no "wait until it is safe to read" — that
  // wait existed only because the transport was a pull.
  const tSettled = Date.now()
  const deadline = Date.now() + Number(a.cap)
  // A launch that never logs its own `am_proc_start` cannot resolve at any cap:
  // it is either a warm start (force-stop did not complete) or the app failed to
  // come up. Waiting the full cap there costs `cap` per attempt and dominates a
  // run's wall clock — bound it separately and let the caller retry.
  const launchDeadline = Date.now() + Number(a.launchTimeout)
  let resolution
  let sawLaunchTime = false
  for (;;) {
    // No adb call: feed whatever arrived since the last tick. `sawLaunchTime` is
    // accumulated across ticks because the line may land in any of them.
    const d = stream.drain(mark)
    mark = d.next
    for (const l of d.lines)
      tracker.ingest(l)
    if (d.lines.some(l => l.includes('am_activity_launch_time') && l.includes('com.lynx.explorer')))
      sawLaunchTime = true
    // Resolves the instant a content-quality layout is in the window, whether or
    // not `lynx runtime ready` has been logged yet: the IFR arm's whole point is
    // painting before that. The rule lives in `tracker.mjs`, not here — a second
    // path that also computed a frame (the old `earlyMs` shortcut) disagreed with
    // this one by 40 ms on a fast device, depending on when the log was read.
    resolution = tracker.decide(Date.now())
    // A dead-on-arrival rep leaves immediately: that verdict is a host fact
    // (`pidof` empty, `am start` never completed), so no amount of waiting can turn
    // it into a measurement.
    if (deadOnArrival || resolution || Date.now() >= deadline)
      break
    // No anchor after `launchTimeout` means nothing can be measured: either AMS
    // never forked the app (the classic dead launch) or this is a warm start that
    // never wrote `am_proc_start`. Both are named by `classify` — waiting the whole
    // `cap` there only makes the re-issue expensive. The bound is on the ANCHOR, not
    // on the frame: the fork event lands within a few hundred ms of `am start`,
    // while the content frame legitimately takes seconds at 1000 rows.
    if (tracker.state.proc === undefined && Date.now() >= launchDeadline)
      break
    // A local tick: nothing is sent to the device, so a 50 ms cadence costs the app
    // nothing (the pull transport's reads did, by up to 115 ms at 1000 rows).
    await stream.wait(50)
  }
  const tResolve = Date.now()

  const s = tracker.state
  const result = classify({
    proc: s.proc,
    pidSeen,
    kill: s.kill,
    shell: s.shell,
    ready: s.ready,
    resolution,
    layouts: s.layouts.length,
    startOut: start,
    wallMs: Date.now() - tStart,
    screenMs: tResolve - tLaunch,
  })
  result.pidAlive = pidAlive
  result.sawLaunchTime = sawLaunchTime
  // `am start -W` prints the device's own launch latency — a direct read on the
  // "the app is stuck for seconds" symptom, independent of the bundle's runtime.
  // `NaN` here means the launch never completed (see `stalledLaunch` above).
  result.launchTotalMs = launchTotalMs
  // What `am start` itself said, and whether the bound killed it. Empty output
  // plus a timeout means the launch request never completed; an error line means
  // AMS refused it. Both leave the same trace in the buffers (no process), so
  // this is the field that tells the two apart.
  result.pidSeen = pidSeen
  // Kept in the record: when present it explains the whole verdict, and it is the
  // only surviving trace of the EMUI/iAware kill (the app logged nothing).
  result.kill = s.kill ?? null
  result.amStartOut = start.replace(/\s+/g, ' ').trim().slice(0, 400)
  result.amStartTimedOut = startRun.timedOut
  // Marker timeline of this rep, relative to its own process start. `--phases`
  // prints it; the content frame is whichever frame the verdict used, with the
  // engine's own `Time taken` for it (the ~0.9 ms empty page vs the tens-to-
  // hundreds of ms content layout is what separates them).
  const rel = t => (t === undefined ? undefined : Math.round((t - s.proc) * 1000))
  if (s.proc === undefined) {
    result.marks = undefined
  }
  else {
    const contentT = resolution?.contentT
    const layout = s.layouts.find(l => l.t === contentT)
    result.marks = {
      shell: rel(s.shell),
      load: rel(s.load),
      ready: rel(s.ready),
      content: rel(contentT),
      contentDurMs: layout ? Number(layout.durMs.toFixed(2)) : undefined,
    }
  }
  // Host-side phase breakdown of this rep. `gap` is the only wait the rig still
  // imposes on purpose (a quiet window for AMS, default 0); `launch` is the app
  // actually coming up; `frame` is waiting for the content line to arrive over the
  // stream; `teardown` is the force-stop plus waiting for the pid to disappear.
  result.timeline = {
    teardown: tTeardown - tStart,
    gap: tGap - tTeardown,
    launch: tLaunch - tGap,
    pidPoll: tPidPolled - tLaunch,
    settle: tSettled - tPidPolled,
    frame: tResolve - tSettled,
    measure: tResolve - tStart,
  }
  return result
}

const med = v => (v.length ? [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] : NaN)
function iqr(v) {
  if (!v.length)
    return [NaN, NaN]
  const s = [...v].sort((x, y) => x - y)
  return [s[Math.floor(s.length * 0.25)], s[Math.floor(s.length * 0.75)]]
}

const arms = ['a', 'b', 'c']
  .filter(p => a[`${p}-url`])
  .map(p => ({
    key: p.toUpperCase(),
    name: a[`${p}-name`],
    bundle: a[`${p}-bundle`],
    url: hashedUrl(a[`${p}-url`], a[`${p}-bundle`]),
  }))
{
  const kb = f => Math.round(fs.statSync(f).size / 1024)
  const sizes = arms.map(x => `${x.name} ${kb(x.bundle)}KB`)
  const same = new Set(arms.map(x => kb(x.bundle))).size < arms.length
  console.log(`  bundles: ${sizes.join(' | ')}${same ? '  ⚠ identical sizes — did a switch fail to apply?' : ''}`)
}
/** Valid measurements per arm, in rep order. */
const valid = {}
/** Every attempt (valid or classified) — the wall-clock account. */
const resultsByArm = {}
/** Every attempt, including failed ones — the complete wall-clock bill. */
const attemptsByArm = {}
const classes = {}
const retries = {}
const recovered = {}
for (const x of arms) {
  valid[x.key] = []
  resultsByArm[x.key] = []
  attemptsByArm[x.key] = []
  classes[x.key] = new Map()
}
let tier2 = 0
function note(side, r) {
  if (r.reason)
    classes[side].set(r.reason, (classes[side].get(r.reason) ?? 0) + 1)
}
const show = r => (r.reason ? `[${r.reason}]` : String(r.proc2first))

/**
 * Measure one arm, re-issuing a DEAD LAUNCH up to `--retries` times — a launch
 * that never produced a window is not a verdict about the app. Every attempt is
 * recorded; a re-issue only replaces the previous one when it resolves, and
 * nothing is ever averaged.
 *
 * Why more than one: in the 296-launch sweep on the 2017 phone, 39 launches
 * (13.2 %) were swallowed by AMS, one re-issue rescued 78 % of those, and 7 of
 * 264 rep slots (2.7 %) were still lost — every one of them the same class
 * (`missing: LynxShell create`). A second re-issue costs ~4.5 s on that device
 * and takes the expected residual below 1 %. Re-issues are only spent on a
 * swallowed launch (`isDeadLaunch`); a real verdict on the retry (e.g.
 * `cap-exceeded`) is kept, because retrying that just burns samples.
 */
/**
 * Everything the buffers can say about ONE failed attempt. Read-only: it runs
 * after the rep's verdict, so it cannot perturb any measured value.
 *
 * The events are cut at the **newest** `am_proc_start` before they are counted,
 * because the buffers span many launches and a stale `am_proc_died` from the
 * previous one would otherwise be read as evidence about this one.
 */
function diagnose(side, r) {
  const ev = adb(['logcat', '-d', '-b', 'events', '-v', 'epoch'], { allowFail: true })
  const mn = adb(['logcat', '-d', '-b', 'main', '-v', 'epoch'], { allowFail: true })
  const pid = adb(['shell', 'pidof', 'com.lynx.explorer'], { allowFail: true }).trim()
  const n = (s, re) => (s.match(re) ?? []).length
  const m = r.marks
  const marks = m
    ? `shell=${m.shell ?? '—'} load=${m.load ?? '—'} ready=${m.ready ?? '—'} content=${m.content ?? '—'}`
    : 'no proc_start (nothing was anchored)'
  const evLines = ev.split('\n')
  const anchor = anchorIndex(evLines)
  const tail = anchor >= 0 ? evLines.slice(anchor).join('\n') : ev
  const events = ['am_create_activity', 'am_restart_activity', 'am_activity_launch_time', 'am_proc_died', 'am_kill', 'am_finish_activity', 'am_destroy_activity', 'Force finishing', 'has died', 'Scheduling restart', 'ANR in', 'Background activity start']
    .map(k => `${k.replace(/^am_/, '')}=${n(tail, new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))}`)
  // Lines that say *why* an engine never came up, if any of them are in the main
  // buffer at all. Presence is the signal; absence is not proof (the ring is
  // 256 KiB and rotates), which is exactly why the marker counts alone were
  // misleading.
  const app = ['FATAL EXCEPTION', 'UnsatisfiedLinkError', 'Loading native libraries', 'dlopen', 'cannot find loader for url', 'Opening URL via lynx://open', 'Opening initial URL', 'chatty', 'lmkd', 'lowmemorykiller', 'Killing', 'EPERM', 'Permission Denial']
    .filter(k => n(mn, new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
  console.log(`  ⚠ ${side} attempt failed: ${r.reason}  pidAlive=${r.pidAlive}  launchTime=${r.sawLaunchTime}`
    + `  amStart=${Number.isFinite(r.launchTotalMs) ? `${r.launchTotalMs}ms` : 'no-total'}`
    + `  pidNow=${pid || 'gone'}  readAt=+${r.wallMs ?? '?'}ms`)
  console.log(`      markers(ms from proc start)  ${marks}`)
  console.log(`      events after the newest proc_start  ${events.join(' ')}`)
  console.log(`      known app lines in main  ${app.length ? app.join(', ') : '— none —'}`)
  // The readings that can actually name a HOST-side reason. `events,main` is not
  // enough for that: what AMS says about a launch it did not perform goes to the
  // `system` buffer, the task's own state is in `dumpsys`, and the request's raw
  // answer is only in `am start`'s own output.
  const pkgEv = evLines.filter(l => l.includes('com.lynx.explorer')).slice(-3)
  const sys = adb(['logcat', '-d', '-b', 'system', '-v', 'epoch', '-t', '600'], { allowFail: true })
    .split('\n')
    .filter(l => /com\.lynx\.explorer|ActivityTaskManager|ActivityManager|WindowManager/.test(l))
    .slice(-5)
  const act = adb(['shell', 'dumpsys', 'activity', 'activities'], { allowFail: true })
    .split('\n')
    .filter(l => /com\.lynx\.explorer/.test(l))
    .slice(0, 4)
  console.log(`      am start (timedOut=${r.amStartTimedOut})  ${r.amStartOut || '(no output)'}`)
  console.log(`      last events for the package  ${pkgEv.length ? pkgEv.map(l => l.trim().slice(0, 120)).join(' ⏎ ') : '— none —'}`)
  console.log(`      system buffer  ${sys.length ? sys.map(l => l.trim().slice(0, 130)).join(' ⏎ ') : '— nothing about it —'}`)
  console.log(`      dumpsys activity  ${act.length ? act.map(l => l.trim().slice(0, 130)).join(' ⏎ ') : '— no record —'}`)
  // What the FULL buffers hold, frame-wise (the driver reads a 3000-line tail).
  // Only the frame SEARCH is repeated here, not the verdict: a dead-on-arrival rep
  // has no frame by definition, so re-running `classify` would just repeat its
  // reason. If this finds a frame, the rig's own read window lost a real one; if it
  // finds none, the rep really had nothing to measure.
  const full = adb(['logcat', '-d', '-b', 'events,main', '-v', 'epoch'], { allowFail: true }).split('\n')
  const ffrom = anchorIndex(full)
  const ft = createTracker()
  for (const l of (ffrom >= 0 ? full.slice(ffrom) : []))
    ft.ingest(l)
  const fframe = ft.decide(Date.now())
  console.log(`      full buffers (${full.length} lines)  ${fframe ? `a frame at +${Math.round((fframe.contentT - ft.state.proc) * 1000)}ms (tier ${fframe.tier}) — the tail lost a real frame` : 'no frame either'}`)
  // Who killed our process, if the window caught it. This is the whole trace of
  // the EMUI/iAware class: the process is forked and killed within milliseconds,
  // so the app never logs anything and nothing else in the buffers mentions it.
  console.log(`      kill record  ${r.kill ? r.kill.slice(0, 220) : '— none in the window —'}`)
  // No log line can answer "did the app paint?" once logd or the ring may have
  // dropped it — but a screenshot can, and it costs one call on a failure path.
  const shot = `${process.env.TEMP ?? '/tmp'}/lynx-dead-${a.label}-${side}-${Date.now()}.png`
  adb(['shell', 'screencap', '-p', '/sdcard/lynx-dead.png'], { allowFail: true })
  adb(['pull', '/sdcard/lynx-dead.png', shot], { allowFail: true })
  adb(['shell', 'rm', '/sdcard/lynx-dead.png'], { allowFail: true })
  console.log(`      screen at the verdict  ${shot}`)
  // Host phases of the attempt. A slow TEARDOWN would point at "the previous
  // instance was still going away when this launch was issued"; a normal one
  // (measured ~0.3 s) rules that out.
  const tl = r.timeline ?? {}
  console.log(`      host phases  teardown ${tl.teardown} | gap ${tl.gap} | launch ${tl.launch} | pidPoll ${tl.pidPoll} | frame ${tl.frame}`)
}

async function attempt(url, side) {
  let r = await oneRep(url)
  attemptsByArm[side].push(r)
  for (;;) {
    if (isRigFailure(r.reason))
      diagnose(side, r)
    if (!isDeadLaunch(r.reason) || (retries[side] ?? 0) >= Number(a.retries))
      break
    // Re-issued, not counted: only the FINAL outcome of a rep goes into the
    // class tally, so "uncovered reps" keeps meaning "reps this arm lost" and a
    // recovered launch shows up as a retry instead of a hole.
    retries[side] = (retries[side] ?? 0) + 1
    await sleep(1000)
    r = await oneRep(url)
    attemptsByArm[side].push(r)
    if (!r.reason)
      recovered[side] = (recovered[side] ?? 0) + 1
  }
  note(side, r)
  resultsByArm[side].push(r)
  return r
}

/**
 * A dark screen silently corrupts every number. The app still starts, but the
 * engine lays out only part of a long screen: the same 1000-row bundle reported
 * a 2.4 ms first layout at ~600 ms with the display off, and 2.2 s with it on.
 * The 2017 phone ships with a 30 s timeout, so a 20-minute sweep turns the
 * screen off by itself — `withScreenAwake` raises it for this run only (bounded,
 * written back on exit; see harness/keep-awake.mjs for why it is bounded).
 */
async function ensureScreenAwake() {
  withScreenAwake({ adb, minutes: KEEP_AWAKE_MIN, label: 'ab-device' })

  const wake = await wakeDevice({ adb, label: 'ab-device' })
  if (!wake.awake || wake.keyguard) {
    console.error(wake.keyguard
      ? 'keyguard is showing — unlock the phone first: every number would be measured behind a lock screen'
      : 'display is off — wake the device first: every number would be measured on a dark screen')
    process.exit(1)
  }
}

async function main() {
  await ensureScreenAwake()
  const records = []
  // The stream must be current before the first launch: a replay of the ring buffer
  // would hand the first rep someone else's `am_proc_start`, and a stalled link
  // would hand it nothing. Both are the rig's fault, not the app's.
  {
    const t0 = Date.now()
    while (!stream.caughtUp() && Date.now() - t0 < 10_000)
      await stream.wait(100)
    if (!stream.caughtUp())
      throw new Error('the logcat stream did not catch up with real time in 10 s')
    stream.discard()
  }
  for (let i = 1; i <= Number(a.reps); i++) {
    const cells = []
    const phases = []
    for (const x of arms) {
      const r = await attempt(x.url, x.key)
      if (!r.reason)
        valid[x.key].push(r.proc2first)
      if (r.tier === 2)
        tier2 += 1
      const wall = r.wallMs ? ` ${(r.wallMs / 1000).toFixed(1)}s` : ''
      const early = r.preReady ? ' pre-ready' : ''
      cells.push(`${x.name} ${show(r).padStart(5)}${wall.padEnd(6)}${early}`)
      records.push({
        rep: i,
        arm: x.key,
        name: x.name,
        value: Number.isFinite(r.proc2first) ? r.proc2first : null,
        // Informational: this frame landed before `lynx runtime ready`. It is the
        // same number as any other rep — the marker only records which side of
        // `ready` the IFR arm's own paint fell on.
        preReady: r.preReady ?? null,
        reason: r.reason ?? null,
        tier: r.tier ?? null,
        wallMs: r.wallMs ?? null,
        marks: r.marks ?? null,
        timeline: r.timeline ?? null,
      })
      if (a.phases && r.marks) {
        const m = r.marks
        const at = k => (m[k] === undefined ? '—' : `${m[k]}`)
        const tail = (m.content !== undefined && m.load !== undefined) ? ` load→content=${m.content - m.load}ms` : ''
        const dur = m.contentDurMs === undefined ? '' : ` dur=${m.contentDurMs}ms`
        phases.push(`      ${x.name.padEnd(12)} shell=${at('shell')}  load=${at('load')}  ready=${at('ready')}  content=${at('content')}${tail}${dur}`)
      }
    }
    console.log(`  rep${String(i).padStart(2)}  ${cells.join('  ')}`)
    for (const p of phases)
      console.log(p)
  }

  // A resolved rep is a measurement; only named classes are holes.
  const fmtHoles = m => ([...m].map(([k, v]) => `${k}×${v}`).join(', ') || 'none')
  console.log(`\n=== ${a.label} (one window, ${arms.length} arms, tier2=${tier2}) ===`)
  for (const x of arms) {
    const v = valid[x.key]
    const [lo, hi] = iqr(v)
    console.log(`  ${x.name}  median ${med(v)}ms  IQR [${lo}, ${hi}]  (valid ${v.length})`)
  }
  // Every pair is same-window by construction: all arms alternate inside a rep.
  for (let i = 0; i < arms.length; i++) {
    for (let j = i + 1; j < arms.length; j++) {
      const left = arms[i]
      const right = arms[j]
      const lv = valid[left.key]
      const rv = valid[right.key]
      const delta = med(rv) - med(lv)
      const [llo, lhi] = iqr(lv)
      const [rlo, rhi] = iqr(rv)
      const overlap = llo <= rhi && rlo <= lhi
      let verdict = 'within noise'
      if (Math.abs(delta) >= 25 && !overlap)
        verdict = delta > 0 ? `${left.name} wins` : `${right.name} wins`
      else if (Math.abs(delta) >= 15)
        verdict = 'trend, not significant'
      console.log(`  Δ ${right.name} − ${left.name} = ${delta > 0 ? '+' : ''}${delta}ms  -> ${verdict}`)
    }
  }
  {
    const m = v => (v.length ? [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] : 0)
    // Resolved reps carry their first-screen time in `proc2first`; everything
    // else is a named class with no number, so this is simply "is there a value".
    const dataOf = r => r.proc2first
    const wall = arms.map((x) => {
      const rs = attemptsByArm[x.key]
      const w = m(rs.map(r => r.wallMs).filter(Boolean))
      const useful = m(rs.map(dataOf).filter(v => Number.isFinite(v)))
      return `${x.name} ${(w / 1000).toFixed(1)}s/rep (${w ? Math.round(100 * useful / w) : 0}% data)`
    })
    console.log(`  wall: ${wall.join(' | ')}`)
    console.log(`  transport: one logcat stream — ${stream.seen()} lines shipped, ${stream.restarts()} reopen(s); no settle, no pull`)
    // Where a rep's host time actually goes. `measure` minus the deliberate waits
    // is the irreducible part; the two waits are what a rig tunes, and their cost
    // is only visible here because the device timeline cannot see host time.
    const hostTl = ['teardown', 'gap', 'launch', 'pidPoll', 'frame', 'measure'].map((k) => {
      const v = arms.flatMap(x => resultsByArm[x.key].map(r => r.timeline?.[k])).filter(Number.isFinite)
      return [k, v.length ? med(v) : NaN]
    })
    if (hostTl.every(([, v]) => Number.isFinite(v))) {
      const o = Object.fromEntries(hostTl)
      console.log(`  host/rep (median): teardown ${o.teardown} | gap ${o.gap} | launch ${o.launch} | pid ${o.pidPoll} | frame ${o.frame} = ${o.measure}ms`)
      console.log(`    deliberate waits ${o.gap}ms (gap; the frame wait is the app, not the rig) | teardown+poll ${o.teardown + o.pidPoll}ms (phase medians, so they need not add up to ${o.measure})`)
    }
  }
  if (a.expect) {
    const [target, tol] = a.expect.split('±').map(Number)
    const band = Number.isFinite(tol) ? tol : 100
    const delta = med(valid[arms[1].key]) - med(valid[arms[0].key])
    const ok = Math.abs(delta - target) <= band
    console.log(`  anchor: expected Δ(B−A) ${target}±${band}ms -> ${ok ? 'ok' : '⚠ MISMATCH'} (measured ${delta}ms)`)
    if (!ok)
      process.exitCode = 2
  }
  console.log(`  uncovered reps — ${arms.map(x => `${x.name}: ${fmtHoles(classes[x.key])}`).join(' | ')}`)
  if (arms.some(x => retries[x.key]))
    console.log(`  re-issued launches (not dropped) — ${arms.map(x => `${x.name}: ${retries[x.key] ?? 0} retried, ${recovered[x.key] ?? 0} recovered`).join(' | ')}`)
  if (arms.every(x => classes[x.key].size === 0))
    console.log('  every launch resolved, nothing dropped ✓')

  if (a.json) {
    const summary = arms.map((x) => {
      const v = valid[x.key]
      const [lo, hi] = iqr(v)
      return {
        key: x.key,
        name: x.name,
        url: x.url,
        median: v.length ? med(v) : null,
        iqr: v.length ? [lo, hi] : null,
        valid: v.length,
        attempts: attemptsByArm[x.key].length,
        retried: retries[x.key] ?? 0,
        recovered: recovered[x.key] ?? 0,
        // How many of this arm's frames landed before `lynx runtime ready`.
        preReady: resultsByArm[x.key].filter(r => r.preReady).length,
        classes: Object.fromEntries(classes[x.key]),
        // Host-side medians, in ms: how long a rep of this arm took and where it
        // went. `measure` is the whole cost of producing one number, not the
        // number itself (that is a device timestamp).
        timeline: Object.fromEntries(['teardown', 'gap', 'launch', 'pidPoll', 'frame', 'measure']
          .map((k) => {
            const v = resultsByArm[x.key].map(r => r.timeline?.[k]).filter(Number.isFinite)
            return [k, v.length ? med(v) : null]
          })),
      }
    })
    fs.writeFileSync(a.json, `${JSON.stringify({ label: a.label, tier2, reps: Number(a.reps), summary, records }, null, 2)}\n`)
    console.log(`  json: ${a.json}`)
  }
  stream?.stop()
}

main()
