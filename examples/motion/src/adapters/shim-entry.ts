/**
 * Motion shim gate — the pure side-effect half of the original
 * `@lynx-js/motion` polyfill (`{shim,element}.ts` split, Apache-2.0).
 * `ElementCompt` lives in `./element.ts`.
 *
 * Evaluating this module installs the facades `motion-dom` snapshots at
 * module eval (rAF / document / queueMicrotask / performance). The rule for
 * every module that value-imports `motion-dom`: bare side-effect-import
 * this file first —
 *
 *   import './shim-entry'
 *
 * (the shared-layer cascade marks every runtime import edge out of a
 * shared-layer module at build time — value, bare side-effect, re-export
 * alike, with no source rewriting; `import type` has no runtime edge to
 * mark. Plan B
 * (`custom/sort-imports-keep-side-effect-position` in eslint.config.js)
 * freezes side-effect imports where you write them, so the gate always
 * evaluates before `motion-dom`, from any entry point.
 *
 * A2: shared modules fully enter the MT graph with exports intact
 * (`solid:shared-mt` / `rules[].with`); `'main thread'` is not required
 * here (that directive only registers worklets).
 *
 * `@lynx-solid/runtime/polyfills` no longer exists — the runtime ships no
 * core-js at all (device baseline ≈ ES2020: `lib` pin + source scan in
 * tests/behavior/device-baseline.test.ts). The queueMicrotask global comes
 * from the runtime's guard (`internal/queue-microtask-shim`), which installs on
 * the BG only — the MT context provides its own. Case files value-import
 * `@lynx-solid/runtime` before `../adapters`, so on the BG the global already
 * exists when `shimQueueMicroTask` runs and that guard skips; this gate stays as
 * the official-parity fallback for graphs that never pull the runtime, and as
 * the app-owned fill the thread contract asks for (docs/guide/mt-ifr.mdx rule 1).
 *
 * Type-only declares for the engine-provided globals (swc LYNX_GLOBALS
 * registers __MAIN_THREAD__/__DEV__; ReactLynx runtime ships bare
 * `if (__MAIN_THREAD__)` for the same reason). No bundler define, no probe.
 */
import { ElementCompt } from './element'

declare const __MAIN_THREAD__: boolean
declare const __DEV__: boolean

const motionWindow = {
  getComputedStyle: (element: ElementCompt) => element.getComputedStyle(),
}

// Capture timeOrigin correctly - use performance.timeOrigin if available, otherwise current timestamp
const timeOrigin
  = (typeof performance !== 'undefined' && performance.timeOrigin)
    ? performance.timeOrigin
    : Date.now()

function shimQueueMicroTask(): void {
  if (!globalThis.queueMicrotask) {
    if (typeof lynx !== 'undefined' && lynx.queueMicrotask) {
      // Bare assignment — byte-identical to official @lynx-js/motion
      // (polyfill/shim.ts:22 ships this exact line with an
      // `@typescript-eslint/unbound-method` disable; 0.0.6 dist matches).
      // Protection against the 2026-09-23 basic incident
      // (`undefined.getNativeLynx`) is ORDER, not binding: the runtime's
      // queueMicrotask shim installs a working impl first on BOTH threads
      // (BG bootstrap + MT entry first-import), so this branch now only
      // serves graphs that never pull the runtime — where React's own
      // motion demos run the same bare reference.
      globalThis.queueMicrotask = lynx.queueMicrotask
    }
    else {
      const resolved = globalThis.Promise.resolve()
      globalThis.queueMicrotask = (fn: () => void) => {
        resolved.then(fn).catch((err: unknown) => {
          setTimeout(() => {
            throw err
          }, 0)
        })
      }
    }
  }
}

function shimGlobals(): void {
  const isLynxForWeb = typeof SystemInfo !== 'undefined'
    && String(SystemInfo.platform) === 'web'

  if (!globalThis.document) {
    // @ts-expect-error Lynx main thread has no document; facade only
    globalThis.document = {}
  }

  if (!globalThis.performance) {
    // @ts-expect-error Lynx main thread has no performance; facade only
    globalThis.performance = {
      now: () => Date.now() - timeOrigin,
    }
  }

  // `lynx.querySelector(All)` exists on device MT but is absent from our
  // engine types — asserted once here, not per call site.
  // as: engine global, our types omit querySelector(All); guarded by ??= below
  const lynxQuery = lynx as unknown as {
    querySelector: typeof document.querySelector
    querySelectorAll: typeof document.querySelectorAll
  }
  document.querySelector ??= lynxQuery.querySelector
  document.querySelectorAll ??= lynxQuery.querySelectorAll

  if (isLynxForWeb || !globalThis.NodeList) {
    // @ts-expect-error placeholder constructor, never instantiated
    globalThis.NodeList = class NodeList {}
  }

  if (isLynxForWeb || !globalThis.SVGElement) {
    // @ts-expect-error placeholder constructor, never instantiated
    globalThis.SVGElement = class SVGElement {}
  }

  if (isLynxForWeb || !globalThis.HTMLElement) {
    // @ts-expect-error placeholder constructor, never instantiated
    globalThis.HTMLElement = isLynxForWeb
      ? ElementCompt
      : class HTMLElement {}
  }

  if (isLynxForWeb) {
    try {
      // @ts-expect-error The wrapper binding intentionally differs from Window.
      // eslint-disable-next-line no-global-assign -- chunk-local binding, not the real global; guarded by try/catch
      window = motionWindow
    }
    catch {
      // Older Lynx for Web runtimes declare the chunk-local `window` binding
      // as a `const`, so this assignment throws. Skip the window facade there
      // instead of failing the whole MTS chunk.
    }
    // @ts-expect-error Lynx main-thread elements intentionally differ from DOM elements.
    globalThis.Element = ElementCompt
    // @ts-expect-error Lynx main-thread elements intentionally differ from DOM event targets.
    globalThis.EventTarget = ElementCompt
    // @ts-expect-error Lynx computed styles intentionally differ from CSSStyleDeclaration.
    globalThis.getComputedStyle = motionWindow.getComputedStyle
  }
  else if (!globalThis.window) {
    // @ts-expect-error minimal window facade, never a real Window
    globalThis.window = motionWindow
  }
  // @ts-expect-error Lynx main-thread elements intentionally differ from DOM elements.
  globalThis.Element ??= ElementCompt
  // @ts-expect-error Lynx main-thread elements intentionally differ from DOM event targets.
  globalThis.EventTarget ??= ElementCompt

  if (!globalThis.getComputedStyle && globalThis.window?.getComputedStyle) {
    globalThis.getComputedStyle = globalThis.window.getComputedStyle
  }

  // motion-dom's frame.mjs captures `requestAnimationFrame` at module-eval
  // (`typeof rAF !== 'undefined' ? rAF : noop`). If that snapshot misses,
  // styleEffect schedules on a permanent noop and transforms never flush.
  // worklet-runtime also installs rAF, but shared re-emit can evaluate
  // motion-dom first — pin it here while shim-entry still runs before
  // any motion-dom import (index.tsx import order).
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    // as: engine global; lynx.requestAnimationFrame is the MT source of truth
    const lynxRaf = lynx as unknown as {
      requestAnimationFrame: (cb: (timeStamp?: number) => void) => number
      cancelAnimationFrame: (id?: number) => void
    }
    if (typeof lynxRaf.requestAnimationFrame === 'function') {
      const raf = (callback: FrameRequestCallback): number =>
        lynxRaf.requestAnimationFrame(time => callback(typeof time === 'number' ? time : 0))
      const caf = (handle: number): void => lynxRaf.cancelAnimationFrame(handle)
      // as: DOM rAF overloads vs engine optional-time signatures; runtime is compatible
      globalThis.requestAnimationFrame = raf as typeof globalThis.requestAnimationFrame
      globalThis.cancelAnimationFrame = caf as typeof globalThis.cancelAnimationFrame
    }
  }

  shimQueueMicroTask()
}

// Official gate in the shape ReactLynx itself ships for both flags:
// `typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__` is verbatim
// from @lynx-js/react runtime (lynx-api.js / lynx.js) — the web host
// doesn't define the flag (device contexts do, per swc LYNX_GLOBALS), and
// `__DEV__` is injected by our plugin in both environments. No custom
// probe (the old capability gate misread a device `window` stub), no new
// define: full DOM facades on device MT, queue fallback on BG in dev.
if (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) {
  shimGlobals()
}
else if (__DEV__) {
  shimQueueMicroTask()
}
