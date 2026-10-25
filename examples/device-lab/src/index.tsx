/**
 * Device selftest — Phase E (native host) behavior suite.
 *
 * Runs the known "web host ≠ device host" difference list as in-page
 * assertions, then POSTs results to the benchmark harness over LAN.
 * Opened via `lynx://open?url=…` (the machine-friendly twin of the QR scan).
 *
 * Cases:
 *  - bg-bare-settimeout        bare setTimeout works; reports globalThis guard
 *  - bg-timer-args-observe     whether the native timer forwards extra callback args
 *  - mt-queue-microtask-guard  MT baseline, classified: host-native vs entry-installed vs absent
 *  - template-static-render    compiled skeleton mounts without throwing
 *  - unmount-oncleanup         Show→false fires onCleanup
 *  - sign-event-bindtap        real native tap → sign chain (tap case; skippable)
 */
import { render, runOnMainThread } from '@lynx-solid/runtime'
import { createSignal, For, onSettled } from 'solid-js'

import './selftest.css'

declare const __DEVICE_REPORT_URL__: string
declare const __DEVICE_TAP_WAIT_MS__: number
declare const __DEVICE_LAB_ARM__: string

interface CaseResult {
  name: string
  pass: boolean | null
  detail: string
  ms: number
}

// Device BG (PrimJS) has no `performance` global — fall back to Date.now.
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

const T0 = now()

// Module-top sentinel: fires before render() — splits "eval crashed" from
// "render crashed" from "POST broken".
void post('module-top', { at: T0 })

// BG error hooks: release Explorer shows no JS in logcat, so errors must
// travel over the report channel.
try {
  globalThis.addEventListener?.('error', (e: { message?: string }) => {
    void post('error', { where: 'error', message: String(e.message ?? e) })
  })
  globalThis.addEventListener?.('unhandledrejection', (e: { reason?: unknown }) => {
    void post('error', { where: 'unhandledrejection', message: String(e.reason) })
  })
}
catch {
  // hook install is best-effort
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function post(kind: string, payload: Record<string, unknown>): Promise<void> {
  const url = __DEVICE_REPORT_URL__
  if (!url)
    return
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...payload }),
      })
      return
    }
    catch {
      await sleep(300)
    }
  }
}

let probeCleaned = false

function Probe(): null {
  // 2.0 canonical: component-level teardown is the cleanup returned from
  // onSettled (onCleanup is reserved for reactive computations).
  onSettled(() => () => {
    probeCleaned = true
  })
  return null
}

function SelftestApp() {
  const [cases, setCases] = createSignal<CaseResult[]>([])
  const [phase, setPhase] = createSignal<'running' | 'waiting-tap' | 'done'>('running')
  const [tapCount, setTapCount] = createSignal(0)
  const [showProbe, setShowProbe] = createSignal(true)
  const [renderedMs, setRenderedMs] = createSignal(0)

  const results: CaseResult[] = []

  /**
   * MT queueMicrotask — sample the implementation, not just its type:
   * `mt` (`__CreatePage` is MT-only PAPI) proves the sample came from the MT,
   * `arm` is compiled in so a stale bundle cannot pose as the other arm, and
   * `src` tells "host built it" (`[native code]`) from "a JS wrapper was
   * installed before app code" (minified source).
   */
  function mtGuardProbe() {
    'main thread'
    const impl = Reflect.get(globalThis, 'queueMicrotask')
    const before = typeof impl
    const lx = Reflect.get(globalThis, 'lynx') as { queueMicrotask?: unknown } | undefined
    const engineFn = lx ? lx.queueMicrotask : undefined
    const si = Reflect.get(globalThis, 'SystemInfo') as { lynxSdkVersion?: string } | undefined
    const info = {
      arm: __DEVICE_LAB_ARM__,
      sdk: si?.lynxSdkVersion ?? '-',
      // On the MT `lynx` is a real global; on the BG it is a wrapper parameter
      // and `globalThis.lynx` does not exist at all. Same word, two deliveries.
      lynxType: typeof Reflect.get(globalThis, 'lynx'),
      mt: typeof Reflect.get(globalThis, '__CreatePage') === 'function',
      // Reflect, not Object.hasOwn: the device baseline is ES2020 (no hasOwn).
      own: Reflect.getOwnPropertyDescriptor(globalThis, 'queueMicrotask') !== undefined,
      same: typeof engineFn === 'function' && impl === engineFn,
      engine: typeof engineFn,
      name: typeof impl === 'function' ? String(impl.name || '-') : '-',
      len: typeof impl === 'function' ? impl.length : -1,
      src: typeof impl === 'function' ? String(impl).replace(/\s+/g, ' ').slice(0, 60) : 'n/a',
    }
    if (before !== 'function') {
      Reflect.set(globalThis, 'queueMicrotask', (fn: () => void) => {
        if (lx && typeof lx.queueMicrotask === 'function')
          (lx.queueMicrotask as (f: () => void) => void)(fn)
        else
          Promise.resolve().then(fn)
      })
    }
    const after = typeof Reflect.get(globalThis, 'queueMicrotask')
    return { before, after, info }
  }

  async function record(name: string, fn: () => Promise<string> | string): Promise<void> {
    const start = now()
    try {
      const detail = await fn()
      results.push({ name, pass: true, detail, ms: now() - start })
    }
    catch (e) {
      results.push({ name, pass: false, detail: String(e), ms: now() - start })
    }
    setCases(results.slice())
  }

  async function main(): Promise<void> {
    // First-frame chain proxy: module eval → mount settled. Device BG has no
    // rAF (it's a UI-thread API) — poll with tasks instead.
    await sleep(0)
    await sleep(16)
    await sleep(16)
    const rendered = now() - T0
    setRenderedMs(rendered)
    // Heartbeat = device time-to-content proxy (explorer open is timed by the
    // runner; this marks BG eval → render → flush done on the device).
    void post('heartbeat', { renderedMs: rendered })

    // 1. bare setTimeout fires; report the globalThis quirk observation.
    let globalSt: string = 'n/a'
    await record('bg-bare-settimeout', () => new Promise<string>((resolve, reject) => {
      // as: probing the device BG timer global shape — it differs per engine build
      globalSt = String((globalThis as unknown as { setTimeout?: unknown }).setTimeout)
      const id = setTimeout(() => {
        clearTimeout(id)
        resolve(`fired; globalThis.setTimeout=${globalSt}`)
      }, 10)
      if (id === undefined)
        reject(new Error('bare setTimeout returned undefined id'))
    }))

    // 2. OBSERVATION: on some Lynx builds the native timer binding consumes
    // only callback+delay and fires the callback with zero args. Record the
    // payload actually received instead of assuming either behaviour.
    await record('bg-timer-args-observe', () => new Promise<string>((resolve, reject) => {
      const id = setTimeout(
        (...args: unknown[]) => {
          clearTimeout(id)
          resolve(`fired; args(${args.length})=${JSON.stringify(args.map(a => String(a)).slice(0, 4))}`)
        },
        10,
        'payload',
      )
      if (id === undefined)
        reject(new Error('bare setTimeout returned undefined id'))
    }))

    // 3a. The same sample on the BG, where the runtime always installs its guard
    // (background/bootstrap.ts): JS source = the guard built the value, `[native
    // code]` = the host had it and the guard skipped.
    await record('bg-queue-microtask', () => {
      const impl = Reflect.get(globalThis, 'queueMicrotask')
      // `lynx` on the BG is a RuntimeWrapperWebpackPlugin PARAMETER: the bare
      // binding has the API, `globalThis.lynx` does not exist. Sample both.
      const gLynx = Reflect.get(globalThis, 'lynx') as { queueMicrotask?: unknown } | undefined
      const bareLynx = (typeof lynx === 'undefined' ? undefined : lynx) as
        | { queueMicrotask?: unknown }
        | undefined
      const gFn = gLynx ? gLynx.queueMicrotask : undefined
      const bFn = bareLynx ? bareLynx.queueMicrotask : undefined
      // Who are these two objects? Same instance or two different surfaces?
      const gObj = gLynx as { getJSContext?: unknown } | undefined
      const bObj = bareLynx as { getJSContext?: unknown } | undefined
      const identity = `gType=${typeof gLynx} sameObj=${gLynx !== undefined && gLynx === bareLynx}`
        + ` gCtx=${typeof gObj?.getJSContext} bareCtx=${typeof bObj?.getJSContext}`
        + ` gKeys=${gLynx ? Object.keys(gLynx).length : -1} bKeys=${bareLynx ? Object.keys(bareLynx).length : -1}`
      const own = Reflect.getOwnPropertyDescriptor(globalThis, 'queueMicrotask') !== undefined
      const src = typeof impl === 'function' ? String(impl).replace(/\s+/g, ' ').slice(0, 60) : 'n/a'
      const si = Reflect.get(globalThis, 'SystemInfo') as { lynxSdkVersion?: string } | undefined
      return `arm=${__DEVICE_LAB_ARM__} sdk=${si?.lynxSdkVersion ?? '-'} type=${typeof impl} own=${own}`
        + ` ${identity} globalLynx=${typeof gFn} bareLynx=${typeof bFn}`
        + ` sameGlobal=${typeof gFn === 'function' && impl === gFn}`
        + ` sameBare=${typeof bFn === 'function' && impl === bFn}`
        + ` src=${src}`
    })

    // 3b. Is the guard's fallback a REAL microtask on this host? On the BG the
    // guard installs `Promise.resolve().then(cb)` (measured: `lynx.queueMicrotask`
    // is undefined here), so everything Solid schedules for its first frame rides
    // on that. The engine's own `setup-promise.ts` polyfill path uses
    // `nextTick = setTimeout(fn, 0)`, so "Promise present" does not by itself
    // prove microtask semantics — this measures the ordering instead: work queued
    // through `queueMicrotask` (what Solid calls) and a two-level `.then` chain
    // must all land before a `setTimeout(…, 0)` queued first.
    await record('bg-microtask-ordering', () => new Promise<string>((resolve) => {
      const log: string[] = []
      const bareLynx = (typeof lynx === 'undefined' ? undefined : lynx) as
        | { queueMicrotask?: (cb: () => void) => void }
        | undefined
      setTimeout(() => log.push('timeout'), 0)
      // The value Solid actually calls (the guard's global).
      queueMicrotask(() => log.push('guard1'))
      // The engine fn the guard prefers, sampled independently.
      if (typeof bareLynx?.queueMicrotask === 'function')
        bareLynx.queueMicrotask(() => log.push('engine1'))
      // A two-level chain on the host's Promise (polyfilled JS on this engine).
      Promise.resolve()
        .then(() => log.push('then1'))
        .then(() => log.push('then2'))
      setTimeout(() => {
        const at = (k: string) => log.indexOf(k)
        const t = at('timeout')
        const before = (k: string) => at(k) !== -1 && at(k) < t
        const engine = at('engine1') === -1 ? 'absent' : String(before('engine1'))
        const detail = `order=${log.join(',')}`
          + ` guardBeforeTimeout=${before('guard1')}`
          + ` engineFnBeforeTimeout=${engine}`
          + ` thenChainBeforeTimeout=${before('then1') && before('then2')}`
          + ` promise=${String(Promise).replace(/\s+/g, ' ').slice(0, 32)}`
        // Hard invariant: the function Solid calls (the guard's global) must be a
        // real microtask — it has to beat a `setTimeout(0)` queued before it. The
        // Promise chain is reported, not asserted: on this engine it legitimately
        // loses (JS polyfill), which is the whole reason the guard exists.
        if (!before('guard1') || engine === 'false')
          throw new Error(`queueMicrotask is not microtask-ordered here — ${detail}`)
        resolve(detail)
      }, 40)
    }))

    // 3. MT queueMicrotask: sample `before` from a worklet (app code always runs
    // after the thread entry, so this cannot see the pre-entry state — the
    // classification in `src` is what separates host-native from installed),
    // then install the documented guard (lynx.queueMicrotask → Promise
    // fallback) and re-prove it on real Lepus.
    try {
      const probe = await runOnMainThread(mtGuardProbe)()
      const i = probe.info
      results.push({
        name: 'mt-queue-microtask-guard',
        // PASS = the sample is from the MT and a working microtask is in place.
        pass: probe.after === 'function' && i.mt,
        detail: `arm=${i.arm} sdk=${i.sdk} mt=${i.mt} lynx=${i.lynxType}`
          + ` before=${probe.before} after=${probe.after}`
          + ` own=${i.own} same=${i.same} engine=${i.engine} name=${i.name} len=${i.len}`
          + ` src=${i.src}`,
        ms: 0,
      })
    }
    catch (e) {
      results.push({ name: 'mt-queue-microtask-guard', pass: false, detail: String(e), ms: 0 })
    }
    setCases(results.slice())

    // 4. compiled skeleton: the page itself is template-backed; reaching
    // 'rendered' without an ops-apply throw is the assertion. Visual truth
    // is the runner's screencap.
    await record('template-static-render', () => {
      if (!rendered)
        throw new Error('never rendered')
      return `mounted in ${rendered.toFixed(1)}ms`
    })

    // 5. unmount cleanup via Show toggle.
    probeCleaned = false
    setShowProbe(false)
    for (let i = 0; i < 50; i++) {
      if (probeCleaned)
        break
      await sleep(20)
    }
    await record('unmount-oncleanup', () => {
      if (!probeCleaned)
        throw new Error('onCleanup did not fire within 1s')
      return 'fired'
    })

    // 6. sign event chain — needs a real native tap (adb input is blocked on
    // this device without MIUI 'USB debugging (Security settings)'; the
    // runner either taps programmatically or asks a human).
    const tapWait = __DEVICE_TAP_WAIT_MS__
    if (tapWait <= 0) {
      results.push({ name: 'sign-event-bindtap', pass: null, detail: 'skipped (no tap wait)', ms: 0 })
    }
    else {
      setPhase('waiting-tap')
      const start = now()
      while (tapCount() === 0 && now() - start < tapWait)
        await sleep(100)
      const n = tapCount()
      results.push({
        name: 'sign-event-bindtap',
        pass: n > 0,
        detail: n > 0 ? `tap received, counter=${n}` : `no tap within ${tapWait}ms`,
        ms: now() - start,
      })
    }
    setCases(results.slice())

    setPhase('done')
    void post('final', { cases: results, marks: { t0: T0, renderedMs } })
  }

  let started = false
  // onSettled = 2.0 replacement for onMount: run once after first settle.
  onSettled(() => {
    if (started)
      return
    started = true
    void main()
  })

  return (
    <view class="page">
      <text class="title">Device Selftest · solid</text>
      <view
        class="tap-btn"
        bindtap={() => setTapCount(c => c + 1)}
      >
        <text class="tap-text">
          TAP ME (
          {tapCount()}
          )
        </text>
      </view>
      <text class="phase">
        phase:
        {phase()}
      </text>
      <text class="mark">
        rendered:
        {renderedMs().toFixed(1)}
        ms
      </text>
      <For each={cases()}>
        {c => (
          <text class={c.pass === false ? 'case fail' : c.pass === null ? 'case skip' : 'case pass'}>
            {`${c.pass === false ? '✗' : c.pass === null ? '-' : '✓'} ${c.name} (${c.ms.toFixed(0)}ms) ${c.detail}`}
          </text>
        )}
      </For>
      {showProbe() && <Probe />}
    </view>
  )
}

render(() => <SelftestApp />)
