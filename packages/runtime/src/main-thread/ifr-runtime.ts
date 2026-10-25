/**
 * MT-IFR runtime entry — what `@lynx-solid/runtime` resolves to for
 * Main-Thread modules when `enableMtIfr` is on.
 *
 * The app entry is the same source on both threads and calls `render(...)` at
 * module scope. On the BG that mounts immediately; on the MT the native page
 * root does not exist yet (the engine calls `renderPage` only after the bundle
 * has evaluated), so `render` here only RECORDS the accessor. `runIfrMount`
 * then does the actual mount, driven from the bootstrap's `renderPage`.
 *
 * Mount shape is deliberately identical to `background/renderer.ts`'s
 * `render()` — same page-root ShadowElement, same `pageRootContext` wrapper —
 * so both threads build the same tree and therefore the same ops. Anything
 * that differed here would show up as an IFR divergence.
 *
 * ## Re-exports must be `import` + `export const`
 *
 * The fork dom compiler DROPS `export … from '…'` statements from the MT
 * output (it keeps plain exported declarations — see the same note in
 * `main-thread/runtime.ts`). So every re-export below is written as an import
 * plus a local `export const`; a re-export form would vanish and leave the
 * bundler with unresolved imports.
 */

import type { Element } from 'solid-js'
import type { WorkletCtx } from '../background/attr-core'
import { createComponent } from 'solid-js'

import { registerBgFunction as registerBgFunctionImpl, transformToWorklet as transformToWorkletImpl } from '../background/bg-function-registry'
import { flushNow, setOpsExecutor } from '../background/flush'
import { ref as refImpl } from '../background/lynx-template'
import { MainThreadRef as MainThreadRefImpl, useMainThreadRef as useMainThreadRefImpl } from '../background/main-thread-ref'
import { takeOps } from '../background/ops-buffer'
import { frameSink, setOpsSink } from '../background/ops-sink'
import { createPageRootState, Page as PageImpl, pageRootContext } from '../background/page'
import { createPageRoot as createPageRootImpl, renderer as rendererImpl } from '../background/renderer'
import { ShadowElement } from '../background/shadow-element'
import { PAGE_ROOT_ID } from '../internal/ops'
import { directSink, resetDirectSink } from './direct-sink'
import {
  abandonIfrRender,
  adoptIfrRender,
  interceptBgOps,
  isIfrEnabled,
  registerIfrRoot,
  takePendingRoot,
} from './ifr'
import { flushListUpdates } from './list-apply'
import { runOnBackground as runOnBackgroundImpl } from './run-on-background-mt'

export type { Element }

// Exported under their original names — the app imports these by name, and the
// alias dance is only to satisfy the compiler's "no re-export" rule.
export const registerBgFunction = registerBgFunctionImpl
export const transformToWorklet = transformToWorkletImpl
export const ref = refImpl
export const MainThreadRef = MainThreadRefImpl
export const useMainThreadRef = useMainThreadRefImpl
export const Page = PageImpl
export const createPageRoot = createPageRootImpl
export const renderer = rendererImpl
export const runOnBackground = runOnBackgroundImpl

/**
 * `runOnMainThread` when the caller is already on the Main Thread (IFR).
 *
 * The Background's version packs a worklet descriptor and ships it across; on
 * this side the body is already here, so the only correct meaning is "run it
 * now". Returning a promise keeps the call-site shape identical, so app code
 * compiled for both threads needs no branch.
 *
 * Found by building the `motion` example with `enableMtIfr`: the MT entry's
 * export surface was missing this name, and the bundler refused the app
 * (`export 'runOnMainThread' was not found`). Every app that calls it from a
 * mount hook hit that, not just this one.
 */
export function runOnMainThread<R, A extends unknown[]>(
  worklet: ((...args: A) => R) | WorkletCtx,
): (...args: A) => Promise<R> {
  return async (...params: A): Promise<R> => {
    if (typeof worklet !== 'function') {
      throw new TypeError(
        '[lynx-solid] runOnMainThread() reached the main thread with a worklet '
        + 'descriptor; the IFR MT build keeps the function body, so this is a '
        + 'compile-order bug',
      )
    }
    return worklet(...params)
  }
}

/**
 * Record the mount for `runIfrMount`. Returns a disposer so the call site
 * keeps the shape the BG entry has (`render()` returns a disposer) — there is
 * nothing to unmount synchronously, since the tree does not exist yet.
 *
 * No `isIfrEnabled()` guard here, deliberately. This module is only ever
 * bundled when `enableMtIfr` is on (the plugin injects it into the MT entry),
 * so "am I enabled" is already settled by the fact that this code ran — and
 * asking anyway deadlocks. Found on device: the phase is still `inactive` on
 * the FIRST `render()` call, which is the only call that matters, so `render()`
 * short-circuited, `registerIfrRoot` never ran, `runIfrMount` found nothing to
 * mount, and the MT waited for the BG exactly as a non-IFR build does — with
 * no error reported anywhere. `solid-build-id-align` missed it by calling
 * `registerIfrRoot` directly instead of going through `render()`.
 */
export function render(root: () => Element): () => void {
  return registerIfrRoot(root)
}

/**
 * Execute the deferred mount against a freshly created page root. Called by
 * the MT bootstrap's `renderPage` right after `__CreatePage`.
 *
 * One-shot: a second call is ignored. IFR owns exactly one first screen per
 * page, and a re-entrant `renderPage` (test envs, reload paths) must not stack
 * trees.
 */
let mounted = false

export function runIfrMount(): boolean {
  if (!isIfrEnabled() || mounted)
    return false
  const root = takePendingRoot<Element>()
  if (!root)
    return false
  mounted = true

  const pageRoot = new ShadowElement('page', PAGE_ROOT_ID)
  const state = createPageRootState(pageRoot)

  // A failed first-screen render must not take down renderPage: drop whatever
  // was partially applied, forget the tree, and let the BG render normally —
  // the same trade vue-lynx (https://github.com/Huxpro/vue-lynx, Apache-2.0)
  // makes.
  //
  // `flushNow` is what makes this one pass rather than many: it drains every
  // batch the render queued into a single captured stream, so there is no
  // per-batch flush to suppress the way vue-lynx has to (its render flushes
  // between batches because Vue's scheduler interleaves async work).
  try {
    const captured: unknown[] = []
    setOpsExecutor((ops) => {
      captured.push(...ops)
    })
    // Every effect is applied as the renderer produces it (direct-sink.ts), so
    // there is no second pass to run. The frames still land in `captured`: that
    // recording is what `ifr.ts` reconciles the Background's first batch
    // against, and dropping it was measured (`norecord`) to cost a teardown +
    // full replay of the first screen.
    resetDirectSink()
    setOpsSink(directSink)
    renderer.render(
      () =>
        createComponent(pageRootContext, {
          value: state,
          get children() {
            return root() as unknown as ShadowElement
          },
        }) as unknown as ShadowElement,
      pageRoot,
    )
    flushNow()
    setOpsExecutor(() => {})
    adoptIfrRender(captured)
    // What is left of the mount: the deferred list bookkeeping (applyOps' tail)
    // and presenting the frame. The application itself already happened while
    // the render ran, because the direct sink applies as it records.
    flushListUpdates()
    __FlushElementTree()
    // Presented: the engine pipeline for this first screen is already closed,
    // so `renderPage` must not open a second one (see the single-flush note
    // there).
    return true
  }
  catch (error) {
    // A throw before `flushNow` leaves this mount's frames in the ops buffer,
    // not in `captured`: drain them so the teardown can see what reached the
    // page (see `abandonIfrRender`). A throw after `adoptIfrRender` leaves the
    // buffer empty and the adopted stream in place; `abandonIfrRender` keeps
    // that one.
    const applied = takeOps()
    setOpsExecutor(() => {})
    console.error(
      '[lynx-solid] MT-IFR first-screen render failed; falling back to the '
      + 'background render.',
      error,
    )
    abandonIfrRender(applied)
    // Nothing presented here: `renderPage` still has to flush, and the
    // Background's ops will paint the first screen the normal way.
    return false
  }
  finally {
    // Hand the sink back: the Background owns the tree from here, and its ops
    // arrive as a batch for the interpreter, not through the sink.
    setOpsSink(frameSink)
  }
}

/** Reset the one-shot mount latch – for testing only. */
export function resetIfrMountForTesting(): void {
  mounted = false
}

/** Drive a mount directly – for testing only (renderPage is the real caller). */
export function renderIfrMountForTest(): void {
  resetIfrMountForTesting()
  runIfrMount()
}

/**
 * Hand the mount to the bootstrap through a global rather than a static
 * import. `main-thread/index.ts` cannot import this module: in a non-IFR build
 * the loader strips the runtime's background modules, so every import here
 * would resolve to an empty module and fail the link. The plugin therefore
 * injects THIS module into the MT entry only when `enableMtIfr` is on, and the
 * bootstrap calls the hook if it happens to be there.
 */
globalThis.__lynxSolidMountIfrRoot = runIfrMount

/**
 * The reconcile hook `lynxSolidApplyOps` consults before applying a batch.
 * Installed here rather than imported there for the same reason as the mount
 * hook above: a non-IFR bundle must not carry `ifr.ts` at all.
 */
globalThis.__lynxSolidInterceptBgOps = interceptBgOps
