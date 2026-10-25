/**
 * Shared skeleton type shapes — lives in `internal/` (same rationale as
 * `js-fn-handle.ts`) so `globals.d.ts` (compiled into both dist/index.js and
 * dist/main-thread/index.js) never imports across into an entry-only module.
 */
import type { LynxElement } from './papi.d.ts'

/** Element creation/attachment surface the skeleton functions call. */
export interface SkeletonP {
  create: (type: string) => LynxElement
  /** Text-run child (__CreateRawText) — inherits parent text styles; not a <text> element. */
  rawText: (content: string) => LynxElement
  append: (parent: LynxElement, child: LynxElement) => void
  cls: (el: LynxElement, value: unknown) => void
  style: (el: LynxElement, value: unknown) => void
  id: (el: LynxElement, value: unknown) => void
  prop: (el: LynxElement, key: string, value: unknown) => void
  event: (el: LynxElement, name: string, sign: string, eventType?: string) => void
}

export type SkeletonCreateFn = (
  P: SkeletonP,
  H: unknown[],
  S: Record<string, unknown>,
) => LynxElement
