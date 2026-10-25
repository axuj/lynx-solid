/**
 * Typed surface of the globals our runtime installs on globalThis.
 *
 * Two distinct worlds share this file:
 *  - Main Thread: engine-contract entry points (processData / renderPage /
 *    updatePage / updateGlobalProps — required by the Lepus runtime) plus
 *    the registries compiled skeleton/worklet modules call as bare
 *    identifiers (runOnBackground).
 *  - Background: the legacy publishEvent hook (SDKs that bypass tt.publishEvent)
 *    and test-only signal hooks.
 *
 * Signatures follow the references: the MT entry of vue-lynx
 * (https://github.com/Huxpro/vue-lynx, Apache-2.0) for the MT contract;
 * `SystemInfo` and `lynx` are already declared by @lynx-js/types
 * (common/global.d.ts) and are intentionally NOT redeclared here.
 *
 * Main-thread worklet globals (`lynxWorkletImpl`, `registerWorklet`,
 * `runWorklet`) are provided by the official
 * `@lynx-js/react/worklet-runtime` package — its
 * `runtime/lib/worklet-runtime/global.d.ts` is pulled in via the reference
 * below. Path is via the nub junction `node_modules/@lynx-js/react` (no
 * version hash) so upgrades don't break it; if the package moves its
 * internal layout, follow it.
 */

/// <reference path="../../node_modules/@lynx-js/react/runtime/lib/worklet-runtime/global.d.ts" />
/// <reference path="./macros.d.ts" />

import type { JsFnHandle } from './js-fn-handle'
import type { SkeletonCreateFn } from './skeleton-types'

/* eslint-disable vars-on-top -- ambient globalThis augmentation requires var */
declare global {
  /**
   * MT-IFR first-screen mount, installed by  and
   * called (optionally) from . A global rather than an import
   * because a non-IFR build must not carry ifr-runtime at all — the plugin
   * injects that module into the MT entry only under .
   */
  var __lynxSolidMountIfrRoot: (() => boolean | void) | undefined

  /**
   * MT-IFR reconcile hook, installed by `main-thread/ifr-runtime` (present
   * only in IFR builds — hence a global rather than an import, same reason as
   * `__lynxSolidMountIfrRoot`). Called by `lynxSolidApplyOps` BEFORE applying a
   * batch: returns true when the batch was consumed here, meaning the caller
   * must NOT apply it again. Without this call the background's first batch
   * lands on top of the main thread's first screen and the IFR paint is thrown
   * away — it is a pure extra repaint, not an optimisation.
   */
  var __lynxSolidInterceptBgOps: ((ops: unknown[]) => boolean) | undefined

  // Ambient globalThis augmentation requires var — assignment is the point.

  /**
   * BG→MT ops channel. Name is the APPLY_OPS_METHOD contract (entry.ts).
   * `worklets` carries pending runOnMainThread dispatches in the same
   * payload so the MT applies ref ops before running them.
   */
  var lynxSolidApplyOps: ((payload: { data: string, worklets?: string }) => void) | undefined

  /**
   * Bare global called by compiled skeleton modules
   * (`registerSkeleton(id, createCode)`), exposed by main-thread/index.ts —
   * same pattern as `runOnBackground`.
   */
  var registerSkeleton: ((id: number, create: SkeletonCreateFn) => void) | undefined

  /**
   * Bare global called by extracted worklet bodies:
   * `runOnBackground(handle)(args)` — registered in main-thread/index.ts,
   * mirrors the official SWC LEPUS pass output.
   */
  var runOnBackground: ((handle: JsFnHandle) => (...args: unknown[]) => Promise<unknown>) | undefined

  /** Lepus data processor. Signature matches the Lynx MT entry contract. */
  var processData: ((data: unknown, processorName?: string) => unknown) | undefined

  var renderPage: ((data?: unknown) => void) | undefined

  var updatePage: ((data?: unknown) => void) | undefined

  var updateGlobalProps: ((data?: unknown) => void) | undefined

  // --- Legacy BG event hook ---------------------------------------------

  /** Some SDK versions call a plain global instead of tt.publishEvent. */
  var publishEvent: ((sign: string, data: unknown) => void) | undefined

  // --- BG event registry (globalThis-shared to avoid module-graph split) ---

  var __LYNX_SOLID_EVENT_REGISTRY__:
    | {
      signCounter: number
      handlers: Map<string, (data: unknown) => void>
    }
    | undefined

  // --- Lynx host timers / console / queueMicrotask -------------------------
  // Declared in env.d.ts (global-script form). This file stays a module
  // because the runtime-installed globals below reference implementation
  // types via import — engine-provided names belong to the environment file.
  //
  // `Console` is the one exception, and only as an interface merge: programs
  // that compile the runtime sources WITHOUT the Lynx `types` (the `tests`
  // program uses the DOM `Console`) must still see the engine-only `alog`
  // channel. `console.alog` is the one that survives into a release build's
  // logcat, and `main-thread/ifr.ts` guards it with
  // `typeof console.alog === 'function'`. Declaring it here merges as an
  // overload with the engine's own signature (`@lynx-js/types` already
  // declares `alog`), so no program disagrees about the call sites; hosts
  // without it simply take the `console.log` branch of the guard.
  interface Console {
    alog: (...args: unknown[]) => void
  }
}

export {}
