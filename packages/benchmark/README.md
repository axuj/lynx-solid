# Benchmark harness (Lynx Solid)

Cross-framework black-box benchmark (lynx-solid vs ReactLynx) on Lynx for Web — methodology ported from the
cross-framework harness of vue-lynx-vapor (the vapor branch of https://github.com/Huxpro/vue-lynx, Apache-2.0).

Two things live here:

- **Automated measurement** — `harness/ab-device.mjs` is the only script that turns a device launch into a number; the
  rest are orchestrators, reporters and the per-rep verdict logic.
- **Manual device driving** — §2 below: for when you need to *look* at a screen yourself (screenshots, taps, logcat,
  instrumentation) rather than wait for a verdict.

## 1. Automated A/B measurement

```bash
node packages/benchmark/harness/ab-device.mjs --serial <serial> \
  --a-bundle <local file> --a-url <url> --a-name def \
  --b-bundle <local file> --b-url <url> --b-name ifr \
  --reps 15 --json <out.json>
```

- The measurement itself (what the number is, when it starts and stops, the pre-committed verdict rule) is documented in
  `harness/ab-device.mjs`'s header comment — read that before trusting or quoting a number.
- **Never pick the flattering run**: change the code → measure again; if several runs disagree, report all of them.
  Every number in a doc must point back to one run's JSON.
- Before measuring: the bundles are from *this* build (not a stale `dist/`), the size assertion passed (the IFR arm must
  be materially larger than the default one), the screen is awake, and no sample was silently dropped (the driver prints
  `uncovered reps`).
- Keeping the screen awake is the driver's job, not yours: `harness/keep-awake.mjs` raises `screen_off_timeout` for the
  length of the run (`--keep-awake-min`, default 60) and writes the original value back on exit. Do not set it by hand,
  and never use `svc power stayon` — `stay_on_while_plugged_in` has no expiry, so one forgotten restore leaves the phone
  awake indefinitely.

Related scripts (see `package.json`): `run.mjs` (cross-framework, Lynx for Web), `sweep.mjs` / `sweep-device.mjs`
(example sweeps), `sweep-rows.mjs` (row-count sweep — where IFR stops winning), `report*.mjs` (reports), `rep-window.mjs`
+ `rep-window.selftest.mjs` (per-rep verdict, unit-tested without a device — `nub run -F @lynx-solid/benchmark selftest`).

## 2. Manual device driving

The three tools, and what each is for — don't use one for everything:

| tool | answers |
|---|---|
| screenshot + tap | "is the screen right?" |
| logcat + instrumentation | "is the state / the timing right?" |
| `ab-device.mjs` | "how much time does it take?" |

### 2.1 Environment

- Test phone `192.168.3.148:5555` (Android 10, screen 1080x2160). Static server `static-8404` feeds bundles to the
  device; the docs site is `nub run -F @lynx-solid/website dev`.
- Launch an app:
  ```bash
  adb -s <serial> shell am start -a android.intent.action.VIEW \
    -d "lynx://open?url=http%3A%2F%2F<ip>%3A8404%2F<file>.lynx.bundle"
  ```
- **The screen must stay on**: let the driver do it. `harness/keep-awake.mjs` raises `screen_off_timeout` for the
  length of the run and writes the original value back on exit; `ensureScreenAwake()` refuses to run on a dark screen.
  Do **not** set `stay_on_while_plugged_in` (or run `svc power stayon`) by hand — it has no expiry, so it outlives the
  run. A manual run uses a bounded `screen_off_timeout` and restores it.

### 2.2 Screenshots and taps

- `adb -s <serial> exec-out screencap -p > shot.png` (~300 ms/shot), `adb -s <serial> shell input tap <x> <y>`.
- The PNG is device resolution (1:1 with device pixels), but **the image you see in the session is scaled** (944x2000) ⇒
  convert coordinates: `x_dev = x_img * 1080/944`.
- **Locate the target again every round** (adding one line of text shifts a list by tens of pixels); "it did nothing" is
  usually a missed tap.
- The device chrome has its own hit areas: Lynx Explorer's top-left "‹" (≈91,151) pops the whole app back to the
  launcher, while the page's own "← Back" (≈137,428 in the networking example) is 277 px lower — easy to mix up.
- One shot is 300 ms: it **cannot catch a few-hundred-millisecond window** ⇒ use logcat or a probe build (§2.4).

### 2.3 logcat

- Lynx routes `console.log` to logcat: `[lynx_console.cc] "[msg]" || args`, with millisecond timestamps.
- Only your own JS errors:
  `adb -s <serial> logcat -d | grep -E "main-thread.js exception|js_error|Uncaught"`
  (the system log has matching keywords from other apps — narrow by tag).
- **Clearing the buffer is not isolation**: `logcat -c` does clear `main` here (7870 → 4 lines) but leaves the `events`
  buffer alone ⇒ isolate a run by timestamp / process anchor, never by "the buffer should only hold my run".
- Tell apart "the app died" / "the screen went off" / "a blank screen":
  `dumpsys window | grep mCurrentFocus`, `pidof com.lynx.explorer`, `dumpsys power | grep "Display Power"`. A pure-white
  shot usually means **the process died and the launcher is in front**.

### 2.4 Instrumentation and probe builds

- Put temporary `console.log`s at **module scope**: BG and MT each have their own bundle, and a top-level log exposes
  both threads' evaluation phase. Prefix them (`[env]`, `[m]`, `[r]`) so they can be filtered.
- The most valuable instrumentation prints **the same value from two sources**: "the cache holds 9 rows while the view
  still renders 10" ⇒ "the write landed, the read did not move" — a screenshot could only ever say "the row did not
  disappear".
- When the window is shorter than the screenshot interval, **build the window**: slow one branch down (e.g. another
  mutation sleeps 2 s), keep the observed path from writing durable state (otherwise the durable write masks the transient
  behaviour), take one frame at a chosen moment, and write the conclusion as a **falsifiable assertion**.
- Remove the probes, rebuild, and re-run the shipped path once more.

### 2.5 Blank web preview (browser side)

The docs' `<Go>` preview runs the example's **web bundle** in an iframe, started by Lynx's web runtime — which is
**WASM**. A static server must send `application/wasm`, or the browser refuses:

```
Failed to execute 'compile' on 'WebAssembly': Incorrect response MIME type. Expected 'application/wasm'.
```

⇒ **every preview goes blank at once** (nothing to do with the example code). Check the browser console, then
`curl -I <wasm path>` for the `content-type`, then fix the MIME table. The project's own `nub run -F @lynx-solid/website
dev` (rspress) serves `.wasm` correctly.
