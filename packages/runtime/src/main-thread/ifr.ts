/**
 * MT-IFR reconciliation — the Main Thread half that stays resident in EVERY
 * build.
 *
 * Without IFR the first frame is BG-driven: the MT creates an empty page root
 * in `renderPage` and waits for the background bundle to boot, evaluate, and
 * ship ops across the thread boundary. Everything above the fold is blank for
 * that whole window. With it, the MT evaluates the app graph itself, once,
 * synchronously — and because it runs the SAME compiled artifact against the
 * SAME `initData` as the BG, the ops it produces are byte-identical to the BG's
 * first batch, so that batch has nothing left to do.
 *
 * ## Why this file may be imported by the bootstrap, and `ifr-runtime` may not
 *
 * The bootstrap (`main-thread/index.ts`) imports this module unconditionally
 * so it can intercept the BG's first batch. That is only safe because every
 * import here is main-thread-local or shared `internal/` — both execute intact
 * on the MT in any build. `ifr-runtime.ts` reaches into `background/`, which a
 * non-IFR build reduces to import shells, so it can only be reached through the
 * plugin-injected MT entry (see `__lynxSolidMountIfrRoot`).
 *
 * ## Three-state reconciliation, and why a diff was worth it
 *
 * vue-lynx's IFR needs a frame-by-frame op walk with a value/identity opcode
 * taxonomy because its recorded stream spans MULTIPLE batches — Suspense
 * resolutions and `defineAsyncComponent` land after paint and still belong to
 * the first screen. A Solid first screen is one synchronous `createRoot` pass;
 * there is no second batch to reconcile against. So:
 *
 *   - streams identical → zero ops. The common case, and the whole point.
 *   - values differ     → `hydrate.ts` hands back the Background's value
 *                         frames; the MT tree stays and those values are
 *                         repainted onto it (a label that moved between the
 *                         two renders, a late async value).
 *   - structure differs → the MT frame cannot be trusted. Tear it down and
 *                         replay the BG batch onto a clean page: correct, with
 *                         a visible repaint.
 *
 * This file used to stop at two states, on the argument that "divergence is a
 * bug, not a runtime condition". That holds for *structural* divergence — a
 * Solid upgrade materializing placeholders differently, which
 * `tests/behavior/solid-build-id-align.test.ts` locks — but not for values:
 * the BG renders later than the MT, so anything read between the two renders
 * (`initData` touched by a task, time, a random seed, a fetch that resolved)
 * legitimately differs. Treating that as a bug cost a full teardown plus the
 * Background's entire first batch on the Main Thread: the IFR path paying for
 * its own first screen *and* the replay, i.e. slower than not doing IFR at
 * all. One changed label used to buy exactly that.
 */

import type { LynxElement } from '../internal/papi.d.ts'
import { OP, OP_ARITY, PAGE_ROOT_ID } from '../internal/ops'
import { getDirectSinkFreshIds } from './direct-sink'
import { elements, resetMainThreadState } from './element-registry'
import { hydrateDiff } from './hydrate'
import { resetListState } from './list-apply'
import { applyOps } from './ops-apply'

export type IfrPhase = 'inactive' | 'enabled' | 'rendered' | 'hydrated'

let phase: IfrPhase = 'inactive'

/**
 * The ops the MT's own render produced. Kept (not just applied) so the BG's
 * first batch can be compared against it; released as soon as hydration
 * resolves, since it pins every value payload of the first screen.
 */
let recordedOps: unknown[] | null = null

/** Set when the app called `render()` before `renderPage` created the root. */
let pendingRoot: (() => unknown) | null = null

/**
 * Whether this build has IFR compiled in at all.
 *
 * NOT "has `render()` been called yet" — that reading deadlocks. `ifr-runtime`
 * asks this from its `render()` to decide whether to defer, but the phase only
 * becomes `enabled` once `registerIfrRoot` runs, which is precisely what
 * `render()` would have skipped. Found on device: `render()` short-circuited,
 * IFR never armed, and the MT silently waited for the BG exactly like a
 * non-IFR build — no error anywhere. `solid-build-id-align` never caught it
 * because it calls `registerIfrRoot` directly and bypasses `render()`.
 *
 * Reaching `ifr-runtime` already means the plugin injected it, and that
 * injection is gated on `enableMtIfr`, so `inactive` here means "not IFR",
 * never "IFR that has not started yet".
 */
export function isIfrEnabled(): boolean {
  return phase !== 'inactive'
}

/**
 * The app entry's `render()` on the MT. The engine calls `renderPage` only
 * after the bundle has evaluated, so by the time a root exists the app has
 * already called this — we hold the accessor and run it from `runIfrMount`.
 */
export function registerIfrRoot(root: () => unknown): () => void {
  if (phase === 'inactive' || phase === 'enabled')
    phase = 'enabled'
  pendingRoot = root
  return () => {}
}

/** Hand the recorded accessor to the mount and clear it (one-shot). */
export function takePendingRoot<T>(): (() => T) | null {
  const root = pendingRoot as (() => T) | null
  pendingRoot = null
  return root
}

/** Adopt the ops the MT's own first-screen render produced. */
export function adoptIfrRender(captured: unknown[]): void {
  recordedOps = captured
  phase = 'rendered'
}

/**
 * Reconcile the BG's first batch against what the MT already painted.
 *
 * Returns true when the batch was consumed here (the caller must not apply it
 * again), false when the caller should apply it normally.
 */
export function interceptBgOps(ops: unknown[]): boolean {
  if (phase !== 'rendered' || recordedOps === null) {
    return false
  }

  const painted = recordedOps
  const result = hydrateDiff(painted, ops)

  if (result.kind === 'match') {
    // Already on screen, frame for frame. The MT keeps the tree; the BG owns
    // it from here and every later batch flows through the normal path.
    releaseRecorded()
    phase = 'hydrated'
    return true
  }

  if (result.kind === 'patch') {
    // Same tree, different values: repaint the Background's frames onto what
    // the MT already painted. Every frame is a value frame on an id the MT
    // owns (hydrate.ts), so this cannot create, move or destroy anything.
    releaseRecorded()
    phase = 'hydrated'
    applyOps(result.ops)
    return true
  }

  return repaint(result.cause)
}

/**
 * Structural divergence: the MT frame cannot be trusted. Remove it and let the
 * BG batch rebuild from a clean page.
 *
 * `console.alog`, not `console.warn`: LOG_SOURCE_JS does not survive into a
 * release build's logcat (LOG_SOURCE_JS_EXT does), and this is the one line
 * that says the fallback happened at all. The cause is included on purpose —
 * a silent fallback is what let a duplicated runtime module instance (every
 * reconcile diverging, every first screen torn down and replayed) go unnoticed.
 */
function repaint(cause: unknown): false {
  // `console.alog` first (LOG_SOURCE_JS_EXT survives into a release build's
  // logcat, where LOG_SOURCE_JS is dropped), then `console.log` for the hosts
  // that have no `alog` at all — web preview and the test doubles. Calling
  // `alog` unguarded threw exactly there, which aborted this function before
  // the teardown and let the thrown error drop the Background's whole batch.
  const line = '[lynx-solid] MT-IFR: the background first batch does not match the '
    + `main-thread first screen (${String(cause)}); repainting from the `
    + 'background. If this fires on every screen, '
    + 'tests/behavior/solid-build-id-align.test.ts has regressed.'
  if (typeof console.alog === 'function')
    console.alog(line)
  else
    console.log(line)
  teardownIfrTree()
  phase = 'hydrated'
  return false
}

/** Mark hydration settled after a failed/absent first-screen render. */
export function abandonIfrRender(applied: unknown[] = []): void {
  // A failed mount never reached `adoptIfrRender`, so `recordedOps` is still
  // null and the teardown below would skip the page-children removal — the
  // created ids live in the direct sink's own record, but *which of them were
  // attached to the page* is only visible in the frame stream. Hand it the
  // frames that were applied before the throw. Without them the aborted tree
  // stays in the engine while the Background's batch recreates the same ids;
  // the interpreter's duplicate-batch guard then drops that whole batch, which
  // on device is `ElementManager::OnPatchFinishForFiber NoPatch!` and a blank
  // screen (found on the `networking` example, 6/7 launches).
  if (recordedOps === null)
    recordedOps = applied
  teardownIfrTree()
  phase = 'hydrated'
}

/** Ids the MT render created, from the appliers' own record. */
function collectCreatedIds(): ReadonlySet<number> {
  return getDirectSinkFreshIds()
}

/** Root-level children the MT attached to the page, so they can be detached. */
function collectRootChildren(ops: unknown[]): Set<number> {
  const children = new Set<number>()
  for (const op of walkOps(ops)) {
    if (op[0] !== OP.INSERT)
      continue
    const parentId = op[1] as number
    const childId = op[2] as number
    if (parentId === PAGE_ROOT_ID)
      children.add(childId)
    else
      children.delete(childId)
  }
  return children
}

/**
 * Remove everything the MT first-screen render created, leaving the page root
 * alone so the BG batch applies exactly as in a non-IFR build.
 *
 * Native `<list>` rows are the trap: they live in list-apply's registries and
 * reach the engine only through the callbacks `__CreateList` closed over, so
 * removing the list element orphans them. A later BG INSERT whose parent id
 * was a discarded `<list>` would then land in a dead list instead of the
 * element tree. `resetListState` makes the abandoned callbacks inert so the
 * replay rebuilds every list from scratch (same hazard vue-lynx documents in
 * teardownIfrTree).
 */
function teardownIfrTree(): void {
  const page = elements[PAGE_ROOT_ID]
  if (recordedOps !== null) {
    const rootChildren = collectRootChildren(recordedOps)
    if (page) {
      for (const id of rootChildren) {
        const el = elements[id]
        if (el)
          __RemoveElement(page, el)
      }
      __FlushElementTree(page)
    }
    // Ids come from the appliers' own record, never from the frame stream: an
    // INSERT's second slot is the parent, an INSTANTIATE's is the template id.
    // Reading positions used to drop the page root, after which every later
    // INSERT from the Background landed on a parent that no longer existed.
    for (const id of collectCreatedIds()) {
      if (id !== PAGE_ROOT_ID)
        elements[id] = undefined
    }
    resetListState()
  }
  releaseRecorded()
  resetMainThreadStateKeepingPage(page)
}

/**
 * `resetMainThreadState` clears `elements` wholesale, which would drop the
 * page-root handle the engine already gave us. IFR teardown only needs the
 * non-root entries gone.
 *
 * Deliberately NOT `resetApplyOpsState()`: that also clears the skeleton
 * registry. Templates are load-time data (the bundle's registration calls) and
 * are never re-sent — the BG's replay only carries template ids. Dropping them
 * turns every `INSTANTIATE` of the replay into `unknown template`, and because
 * the ops interpreter isolates each frame, the screen stays blank with nothing
 * surfacing to the user.
 */
function resetMainThreadStateKeepingPage(page: LynxElement | undefined): void {
  resetMainThreadState()
  if (page)
    elements[PAGE_ROOT_ID] = page
}

function releaseRecorded(): void {
  recordedOps = null
}

/** Frame-by-frame walk over a flat ops array. */
function* walkOps(ops: unknown[]): Generator<unknown[]> {
  let i = 0
  while (i < ops.length) {
    const code = ops[i] as number
    const arity = OP_ARITY[code as keyof typeof OP_ARITY]
    if (arity === undefined)
      return // unknown op — stop rather than misread the rest
    yield ops.slice(i, i + arity + 1)
    i += arity + 1
  }
}

/** Reset all IFR state – for testing only. */
export function resetIfrForTesting(): void {
  phase = 'inactive'
  recordedOps = null
  pendingRoot = null
}

export function __getIfrPhase(): IfrPhase {
  return phase
}

export function __getIfrRecordedOps(): unknown[] | null {
  return recordedOps
}
