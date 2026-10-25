/**
 * Screen stay-awake for a benchmark run — **the only place in the harness that
 * touches a persistent device setting**.
 *
 * Why this module exists: `screen_off_timeout` survives reboots and applies to
 * the whole phone, so a driver that raises it and forgets to write it back
 * leaves the owner's phone awake until they notice. That happened three times,
 * once per copy of this logic — `svc power stayon usb` never restored,
 * `2147483647` never restored, and a "restore" that wrote `2` instead of the
 * original value. One module means it can only be wrong once.
 *
 * Contract:
 *   - only `screen_off_timeout` is written. `stay_on_while_plugged_in` is never
 *     touched: it has no expiry and is a developer setting the owner controls
 *     (and a bounded timeout already covers a run, so it would be redundant).
 *   - `wakeDevice` below only sends transient keyevents / reads dumpsys; it
 *     writes no setting. `screen_off_timeout` stops the phone going to sleep
 *     `during` a run, it cannot bring a sleeping screen back.
 *   - the value is **bounded** (minutes, default 60), never "never": a SIGKILL
 *     skips `restoreOnExit`, and a bounded value then expires on its own
 *     instead of pinning the phone awake forever.
 *   - the original value is written back on every exit path we can observe.
 *
 * Usage: pass the driver's own `adb` thunk so this module stays transport-free.
 *   withScreenAwake({ adb: (argv, o) => adb(serial, argv, o), label: 'device' })
 */

import fs from 'node:fs'
import process from 'node:process'

const KEY = 'screen_off_timeout'
const DEFAULT_MINUTES = 60

/**
 * Decide what this run should do with `screen_off_timeout`.
 *
 * `settings get` prints the literal `null` when the key was never set. That is
 * the platform default (the phone sleeps after its stock timeout), not an
 * unparseable value — treating it as one skipped the raise, the phone slept
 * mid-run, and every later row was measured on a dark display while still
 * reporting a number. Returns `null` when the setting should be left alone
 * (unknown value, or already longer than the run needs).
 */
export function planScreenTimeout(raw, minutes = DEFAULT_MINUTES) {
  const unset = raw === '' || raw === 'null'
  const original = unset ? null : Number(raw)
  const boundMs = Math.max(1, Number(minutes) || DEFAULT_MINUTES) * 60_000

  // Never guess a restore target for a value we do not understand.
  if (!unset && (!Number.isFinite(original) || original <= 0))
    return null
  if (original !== null && original >= boundMs)
    return null

  return { unset, original, boundMs }
}

/**
 * Run `restore` exactly once, on every exit path we can observe: a normal
 * return, `process.exit()`, Ctrl-C, `kill`. SIGKILL still bypasses it — which
 * is why the value handed to the setting is bounded (see the header).
 */
export function restoreOnExit(restore) {
  let done = false
  const run = () => {
    if (done)
      return
    done = true
    try {
      restore()
    }
    catch {}
  }
  process.on('exit', run)
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(signal, () => {
      run()
      process.exit(code)
    })
  }
}

/**
 * Raise `screen_off_timeout` for the duration of this run only, and write the
 * original value back on exit.
 *
 * @param {object} options
 * @param {(argv: string[], opts?: { allowFail?: boolean }) => string} options.adb
 *   The driver's adb thunk — takes an argv array, returns combined output.
 * @param {number} [options.minutes] Upper bound, in minutes.
 * @param {string} [options.label] Log prefix (`device`, `ab-device`, …).
 */
export function withScreenAwake({ adb, minutes = DEFAULT_MINUTES, label = 'harness' }) {
  const read = () => adb(['shell', 'settings', 'get', 'system', KEY], { allowFail: true }).trim()
  const write = value => adb(['shell', 'settings', 'put', 'system', KEY, String(value)], { allowFail: true })
  const clear = () => adb(['shell', 'settings', 'delete', 'system', KEY], { allowFail: true })

  const plan = planScreenTimeout(read(), minutes)
  if (!plan)
    return

  const { unset, original, boundMs } = plan
  write(boundMs)
  console.log(`[${label}] ${KEY} → ${boundMs} ms for this run (was ${unset ? 'unset' : original}); restored on exit`)
  restoreOnExit(() => {
    if (unset)
      clear()
    else
      write(original)
    // `fs.writeSync`, not console: stdout can be a pipe, which drops async
    // writes once the process starts exiting.
    fs.writeSync(2, `[${label}] ${KEY} ${unset ? 'cleared (was unset)' : `restored to ${original}`}\n`)
  })
}

const KEYGUARD_RE = /^\s*showing=true\b|mShowingLockscreen=true|mDreamingLockscreen=true/m

/**
 * Wake the screen and clear a non-secure keyguard.
 *
 * `withScreenAwake` only keeps an already-on screen on; a run started against a
 * sleeping phone records `fg=0` for every bundle (or, worse, measures layout on
 * a dark screen). Every driver calls this before its first launch instead of
 * trusting the owner to leave the phone awake.
 *
 * A secure lock (PIN/pattern/biometric) cannot be bypassed over adb. When one
 * is still up after the wake + MENU attempts, the caller must abort with an
 * actionable message — silently scanning produces 33 meaningless failures.
 *
 * @param {object} options
 * @param {(argv: string[], opts?: { allowFail?: boolean }) => string} options.adb
 *   The driver's adb thunk — takes an argv array, returns combined output.
 * @param {string} [options.label] Log prefix (`device`, `ab-device`, …).
 * @param {number} [options.attempts] WAKEUP attempts before giving up.
 * @param {number} [options.retryMs] Settle time after each attempt.
 * @param {number} [options.settleMs] Wait after a successful wake before the
 *   caller's first launch: the panel and CPU governor are still ramping when
 *   `KEYCODE_WAKEUP` returns, and that tail otherwise lands in the measurement.
 * @returns {Promise<{ awake: boolean, keyguard: boolean }>} Whether the screen
 *   woke up, and whether a keyguard is still covering it.
 */
export async function wakeDevice({ adb, label = 'harness', attempts = 3, retryMs = 500, settleMs = 2000 }) {
  const call = argv => adb(argv, { allowFail: true })
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

  let awake = false
  for (let i = 0; i < attempts && !awake; i++) {
    call(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
    call(['shell', 'wm', 'dismiss-keyguard'])
    await sleep(retryMs)
    awake = /mWakefulness=Awake/.test(call(['shell', 'dumpsys', 'power']))
  }

  // MENU is the keyevent several ROMs map to "dismiss keyguard". Only send it
  // while the keyguard is actually up, so an already-unlocked launcher does not
  // get an unexpected menu key.
  let keyguard = KEYGUARD_RE.test(call(['shell', 'dumpsys', 'window', 'policy']))
  if (awake && keyguard) {
    call(['shell', 'input', 'keyevent', 'KEYCODE_MENU'])
    call(['shell', 'wm', 'dismiss-keyguard'])
    await sleep(retryMs)
    keyguard = KEYGUARD_RE.test(call(['shell', 'dumpsys', 'window', 'policy']))
  }

  if (!awake) {
    console.error(`[${label}] screen did not wake after ${attempts} attempts (mWakefulness is not Awake)`)
  }
  else if (keyguard) {
    console.error(`[${label}] keyguard is still showing — unlock the phone (adb cannot bypass a secure lock)`)
  }
  else {
    await sleep(settleMs)
    console.log(`[${label}] screen awake, keyguard clear (settled ${settleMs} ms)`)
  }

  return { awake, keyguard }
}
