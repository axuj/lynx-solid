/**
 * Test-only signal drivers for the vitest behavior suites (scene modules
 * stash their setters on globalThis so tests can drive reactivity).
 *
 * Lives here — NOT in packages/runtime/src/internal/globals.d.ts — because nothing outside
 * tests/ references these, and the published package ships dist typings
 * only. This keeps test helpers out of the shipped global surface. (Runtime
 * and engine globals belong in packages/runtime/src/internal/globals.d.ts;
 * test drivers are the single exception.)
 * The node tsconfig program (tests + plugin + compiler) picks this file up,
 * so the suites below keep full typechecking.
 *
 * `__lynxSetCount` was declared in the old location but never used by any
 * suite, so it is dropped here rather than carried over.
 */
/* eslint-disable vars-on-top -- ambient globalThis augmentation requires var */
declare global {
  var __lynxSetOn: ((v: unknown) => void) | undefined
  var __lynxSetItems: ((v: unknown) => void) | undefined
  var __lynxSetX: ((v: unknown) => void) | undefined
  var __lynxSetA: ((v: unknown) => void) | undefined
  var __lynxSetB: ((v: unknown) => void) | undefined
  var __lynxSetListA: ((v: unknown) => void) | undefined
  var __lynxSetListB: ((v: unknown) => void) | undefined
}

export {}
