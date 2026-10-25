/**
 * Elk demo globals — isolated from the runtime core.
 *
 * `__elkGlobalProps` is injected by the Elk shell (or Lynx `updateGlobalProps`)
 * and consumed only by the Elk demo. It does NOT belong in
 * `src/internal/globals.d.ts`, which is the framework's typed surface.
 */

/* eslint-disable vars-on-top -- ambient globalThis augmentation requires var */
declare global {
  // Global initial path injected by the Elk app (demo only)
  var __elkGlobalProps: { initialPath?: string } & Record<string, unknown> | undefined

  // Viewport scroll is meaningless on Lynx (no DOM viewport).
  // @tanstack/solid-router calls the bare `scrollTo` global after navigations;
  // unlike document/window (shadowed by the Lynx BG Function params) this
  // name is NOT shadowed, so a globalThis install is visible to bundle code.
  // Browsers keep their native (fill-if-missing only).
  var scrollTo: ((options?: { top?: number, left?: number, behavior?: string }) => void) | undefined

  // Worker-scope alias. TanStack tags the router instance for devtools via
  // bare `self.__TSR_ROUTER__` in its constructor; PrimJS provides no `self`,
  // and RuntimeWrapperWebpackPlugin injects `self` as a wrapper Function
  // parameter (shadowed undefined on device), so polyfills.ts syncs the
  // wrapper-scope binding itself (`self = globalThis`), not just the
  // globalThis property. Browsers/workers keep their native
  // (fill-if-missing only).
  var self: typeof globalThis | undefined
}

export {}
