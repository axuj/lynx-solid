/**
 * Per-rep log window + verdict classification, split out of `ab-device.mjs` so
 * it can be tested without a device (see `rep-window.selftest.mjs`).
 *
 * Why this exists at all — two rig bugs found on a weak 2017 phone over adb
 * WiFi:
 *
 *  1. Clearing the buffer is not available. `logcat -c` needs privileges the
 *     shell lacks on Android 10: it returns 1 ("failed to clear the 'crash'
 *     log"). The previous rep's markers therefore survive into the next one, and
 *     the tracker takes the FIRST process start it sees — that produced
 *     spurious fast verdicts (a repeated constant, or content before the
 *     process start). `anchorIndex` fixes it without clearing anything: only
 *     lines from the NEWEST process start onward belong to this rep.
 *  2. A rep must never be silently dropped. `classify` turns everything that is
 *     not a measurement into a named reason, so the tally can be printed next
 *     to the medians — medians are computed on valid reps only, and dropping
 *     the slow tail biases them (the two arms can lose different tails).
 *
 * ## The taxonomy is all failure
 *
 * A resolved rep is a measurement, full stop: the value is the first layout that
 * cleared the duration floor, and whether it landed before or after `lynx
 * runtime ready` is recorded as `preReady` but changes nothing. (That used to be
 * a separate class with its own number, which meant the same arm in the same
 * window could report one value or the other depending on when the log was
 * read.) Everything in the reason taxonomy is therefore the rig failing to
 * measure: `launch-error`, the three `missing: …`, `cap-exceeded`, `stale-buffer`
 * — see `isRigFailure` / `isDeadLaunch` below. Retrying the wrong kind is what
 * quietly loses samples.
 */

/**
 * Index of the last `am_proc_start` for the app under test, i.e. where this
 * rep's window begins. `-1` when this rep's start has not been logged yet: the
 * caller must then ingest NOTHING rather than risk the previous rep's markers.
 */
export function anchorIndex(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('am_proc_start') && lines[i].includes('com.lynx.explorer'))
      return i
  }
  return -1
}

/**
 * `tracker.state` + the tracker's resolution + `am start`'s stdout → either a
 * measurement (`{ proc2first, shell2first, tier, layouts }`) or
 * `{ reason }` naming exactly what was missing.
 */
/**
 * The interesting part of an `am_kill` record: who killed the process, and why.
 * EMUI writes its own reason inside the record — `stop com.lynx.explorerfrom pid
 * 1691 iAwareF[CrashClean] 9877579ms]` — while AOSP puts `lmkd` or the low-memory
 * killer there. Falls back to the record's last field so an unknown killer is
 * still reported verbatim instead of being flattened to "host".
 */
function killerOf(line) {
  const known = /iAware\w*(?:\[[^\]]*\])?|CrashClean|lmkd|low ?memory ?killer|ANR/i.exec(line)
  if (known)
    return known[0]
  const tail = line.replace(/\]\s*$/, '').split(',').pop()?.trim() ?? ''
  return tail ? tail.slice(0, 40) : 'unknown'
}

export function classify({ proc, pidSeen, kill, shell, ready, resolution, layouts, startOut = '', wallMs = 0, screenMs = 0 }) {
  const timing = (wallMs || screenMs) ? { wallMs, screenMs } : {}
  if (proc === undefined)
    return { reason: /error|exception|not found/i.test(startOut) ? 'launch-error' : 'missing: am_proc_start', ...timing }
  // No process ever appeared for this launch. Everything in the window then
  // belongs to an earlier launch — including, sometimes, ITS `am_proc_start`
  // (the window is a log tail, so a stale anchor is the normal case). A frame
  // found after such an anchor would look like a plausible number for a launch
  // that never happened, so this verdict must win over a resolution.
  if (pidSeen === false) {
    // If the buffer saw a kill, name the killer: this is the EMUI/iAware case,
    // where the process IS forked and then killed ~3 ms later, so the app never
    // logs a line and the rig can only tell "the host did it, and this is who".
    return { reason: kill ? `host-killed: ${killerOf(kill)}` : 'missing: am_proc_start', ...timing }
  }
  if (!resolution) {
    // No frame at all: now the missing marker IS the diagnosis, because it is
    // the earliest thing the engine logs — `missing: LynxShell create` means the
    // engine never came up, and `missing: lynx runtime ready` means the
    // background runtime never booted.
    if (shell === undefined)
      return { reason: 'missing: LynxShell create', ...timing }
    if (ready === undefined)
      return { reason: 'missing: lynx runtime ready', ...timing }
    return { reason: 'cap-exceeded', layouts, ...timing }
  }

  const proc2first = Math.round((resolution.contentT - proc) * 1000)
  // Content before the anchored start can only mean the anchor missed.
  if (proc2first < 0)
    return { reason: 'stale-buffer', proc2first, ...timing }
  // A FRAME IS THE MEASUREMENT; the two markers above are diagnostics and may
  // legitimately be absent. They are the first lines the engine writes, and
  // `main` is a 256 KiB ring on the 2017 phone — one launch writes enough to
  // evict its own `LynxShell create` before the first read, so requiring it
  // threw away 18 real frames in a single session and reported them as dead
  // launches. (Same defect as gating the frame on `lynx runtime ready`; the
  // difference is only which marker was used as the door.)
  return {
    proc2first,
    shell2first: shell === undefined ? null : Math.round((resolution.contentT - shell) * 1000),
    tier: resolution.tier,
    layouts: resolution.layoutCount,
    // `null` = the marker rolled out of the buffer, so "did it paint before the
    // runtime was up?" is unanswerable for this rep rather than `false`.
    preReady: ready === undefined ? null : resolution.contentT < ready,
    ...timing,
  }
}

/**
 * Did the rig fail to measure this rep? Every class that carries a number of its
 * own returns `false`; a resolved rep is never a rig failure, whether its frame
 * landed before or after `lynx runtime ready`.
 */
export function isRigFailure(reason) {
  return reason !== undefined
}

/**
 * A launch that never produced a window: the app did not come up, so this rep
 * says nothing about the arm and must be re-issued rather than counted.
 *
 * `missing: LynxShell create` belongs here even though a process did start:
 * measured on the 2017 phone it always comes with `am start -W` printing no
 * `TotalTime`, i.e. AMS swallowed the launch. Leaving it out of the retry set
 * (as this driver used to) costs a sample per occurrence, and the losses are
 * not symmetric between arms — the first arm measured in a rep takes them.
 */
export function isDeadLaunch(reason) {
  return reason === 'launch-error'
    || reason === 'missing: am_proc_start'
    || reason === 'missing: LynxShell create'
    // The host killed our process right after forking it (EMUI/iAware): a fresh
    // launch is the fix, and it is what the retry does.
    || (reason?.startsWith('host-killed') ?? false)
}
