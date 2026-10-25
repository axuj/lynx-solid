import type { MainThread } from '@lynx-js/types'

import type {
  AnimationPlaybackControls,
  EffectKeyframes,
  EffectTransition,
  ElementOrSelector,
  MotionValue,
} from 'motion-dom'
// Gate first: Plan B freezes this side-effect import where it stands, so
// the shim evaluates before `motion-dom` below (frame.mjs snapshots rAF at
// module eval). No attribute written here — the shared-layer cascade marks
// this edge at build time (its importer is already on the layer), the same
// rule that carries the value imports below.
import './shim-entry'
import { animateElement, animateValue, mix, styleEffect as styleEffect_ } from 'motion-dom'
import { ElementCompt } from './element'

/**
 * Element-animation entry over `motion-dom`, shaped like `@lynx-js/motion`'s
 * `animation/index.ts` element path (Apache-2.0) minus the `motion` package
 * (its entry pulls `@lynx-js/react`; unusable here — see docs).
 *
 * This module is reached from case files through the `./index` barrel
 * (the root `with { runtime: 'shared' }` edge lives there); `solid:shared-mt`
 * then tags its plain value imports (transitive shared) so the whole
 * downstream graph keeps full exports. `'main thread'` on a target only
 * registers worklets.
 *
 * The bare `./shim-entry` import above is this file's half of the ordering
 * rule: every module that value-imports `motion-dom` side-effect-imports
 * the gate first (frozen in place), so eval order holds from any entry
 * point — import order in case files is free.
 *
 * All exports are deliberately directive-free: each is only ever *called
 * from* worklets, never used *as* one, so they travel as ordinary
 * MT-local code. Do not add `'main thread'` directives here.
 */

function isMainThreadElement(ele: unknown): ele is MainThread.Element {
  return typeof ele === 'object' && ele !== null && 'element' in ele
}

function isMainThreadElementArray(
  eleArr: unknown,
): eleArr is MainThread.Element[] {
  return Array.isArray(eleArr) && eleArr.every(ele => isMainThreadElement(ele))
}

function elementOrSelector2Dom(
  nodesOrSelector: string | MainThread.Element | MainThread.Element[],
): ElementOrSelector | undefined {
  // Official @lynx-js/motion elementHelper: string → lynx.querySelectorAll,
  // then always ElementCompt — no isMainThreadElement gate on query results
  // (web-host nodes lack `.element` and must still bind styleEffect).
  if (
    typeof nodesOrSelector === 'string'
    || isMainThreadElement(nodesOrSelector)
    || isMainThreadElementArray(nodesOrSelector)
  ) {
    let elementNodes: MainThread.Element | MainThread.Element[]
    if (typeof nodesOrSelector === 'string') {
      // as: engine global; lynx.querySelectorAll exists on device MT, types omit it (same as shim-entry)
      elementNodes = (lynx as unknown as {
        querySelectorAll: (selector: string) => MainThread.Element[]
      }).querySelectorAll(nodesOrSelector)
      if (!elementNodes || (Array.isArray(elementNodes) && elementNodes.length === 0))
        return undefined
    }
    else {
      elementNodes = nodesOrSelector
    }
    return Array.isArray(elementNodes)
      ? elementNodes.map(el => new ElementCompt(el)) as unknown as ElementOrSelector // as: ElementCompt impersonates Element; no narrowing exists
      : new ElementCompt(elementNodes) as unknown as ElementOrSelector // as: ElementCompt impersonates Element; no narrowing exists
  }
  return undefined
}

export interface TweenOptions {
  duration?: number
  delay?: number
}

/** Minimal playback handle — the demos only ever call `.stop()`. */
export interface AnimationHandle {
  stop: () => void
}

/**
 * Animate live Lynx element(s) with keyframes through `motion-dom`'s
 * `animateElement`: easing, delay, repeat, and the JS-animation fallback
 * all run inside the engine; style reads/writes cross through the proxy
 * to `setStyleProperty` / `__GetComputedStyleByKey`.
 *
 * `transition` times stay in **seconds** (official `animate()` surface) —
 * the element path reaches `animateMotionValue`, which converts s→ms
 * itself. Do not pre-convert here; a second multiply turns `duration: 1`
 * into 1000 seconds. Returns a handle whose `stop()` cancels every
 * per-key control.
 *
 * Prefer explicit `[from, to]` keyframes over a bare target object: a
 * single unresolved keyframe makes the engine read current styles via
 * the global `getComputedStyle`, which rejects proxy subjects on web
 * hosts. Explicit frames never read.
 */
export function animateEl(
  element: string | MainThread.Element | MainThread.Element[],
  keyframes: EffectKeyframes,
  transition?: EffectTransition,
): AnimationHandle {
  const dom = elementOrSelector2Dom(element)
  if (!dom)
    throw new Error('[motion] animateEl: no element resolved')
  const subjects = Array.isArray(dom) ? dom : [dom]
  const controls = subjects.flatMap((subject) => {
    // as: ElementCompt impersonates StyleSubject by design; engine duck-types, no narrowing exists
    return animateElement(subject as never, keyframes, transition)
  })
  return {
    stop: () => {
      for (const control of controls)
        control.stop()
    },
  }
}

/** Public Motion API times are seconds; direct `animateValue` (JSAnimation) wants ms. */
function secondsToMs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value * 1000
}

/**
 * Drive a MotionValue through keyframes (the `animate(mv, …)` path).
 * `duration` / `repeatDelay` are **seconds** (official surface), converted
 * to ms here because `animateValue` is the raw JSAnimation constructor —
 * unlike the element path, nothing downstream converts. `onUpdate` must
 * call `mv.set` — the official bridge; `JSAnimation` never writes the
 * MotionValue itself.
 */
export function animateMv(
  mv: MotionValue<number>,
  keyframes: number[],
  options?: {
    duration?: number
    repeat?: number
    repeatType?: 'loop' | 'reverse' | 'mirror'
    repeatDelay?: number
    ease?: EffectTransition['ease']
  },
): AnimationPlaybackControls {
  return animateValue({
    keyframes,
    motionValue: mv,
    duration: secondsToMs(options?.duration ?? 1),
    repeat: options?.repeat ?? 0,
    repeatType: options?.repeatType,
    repeatDelay: secondsToMs(options?.repeatDelay ?? 0),
    ease: options?.ease,
    onUpdate: (v: number) => {
      mv.set(v)
    },
  })
}

/**
 * Tween a number on the main thread; style writes happen in `onUpdate`,
 * which runs on the main thread alongside the engine.
 * `duration` / `delay` are seconds (official surface), converted to ms.
 */
export function tween(
  from: number,
  to: number,
  onUpdate: (value: number) => void,
  options?: TweenOptions,
): AnimationPlaybackControls {
  return animateValue({
    keyframes: [from, to],
    duration: secondsToMs(options?.duration ?? 0.5),
    delay: secondsToMs(options?.delay ?? 0),
    onUpdate,
  })
}

/**
 * Color blender: `blend(0)` returns `from`, `blend(1)` returns `to`. Pure —
 * callable on either thread.
 */
export function colorMixer(from: string, to: string): (progress: number) => string {
  return mix(from, to)
}

/**
 * Bind MotionValues to a live element's styles (transforms, colors).
 * Port of `@lynx-js/motion`'s `styleEffect` wrapper: subjects cross
 * through `ElementCompt` first, so the engine never sees a raw element.
 * Returns an unsubscribe function, like the original.
 */
export function styleEffect(
  element: string | MainThread.Element | MainThread.Element[],
  values: Record<string, MotionValue>,
): () => void {
  const dom = elementOrSelector2Dom(element)
  if (!dom)
    return () => {}
  return (styleEffect_ as unknown as (
    subject: ElementOrSelector,
    vals: Record<string, MotionValue>,
  ) => () => void)(dom, values) // as: ElementCompt | ElementCompt[] impersonates motion-dom subject; no narrowing exists
}

/**
 * Spring a MotionValue back to a target (overscroll snap-back).
 * Drive through `mv.start` so the running animation lands on `mv.animation` —
 * the same contract as official `animate(mv, …)` / `animateSingleValue`.
 * `touchstart`'s `mv.stop()` then cancels the spring mid-flight (grab during
 * overscroll). Explicit `[from, to]` keyframes (web-host getComputedStyle
 * rejects proxy subjects); `onUpdate` bridges into the MotionValue.
 */
export function springValueTo(
  mv: MotionValue<number>,
  target: number,
  options?: { stiffness?: number, damping?: number },
): void {
  void mv.start(complete =>
    animateValue({
      keyframes: [mv.get(), target],
      motionValue: mv,
      type: 'spring',
      stiffness: options?.stiffness ?? 200,
      damping: options?.damping ?? 60,
      onUpdate: (v: number) => {
        mv.set(v)
      },
      onComplete: complete,
    }),
  )
}

/** Linear progress of `value` in `[from, to]`. motion-dom lacks it. */
export function calcProgress(from: number, to: number, value: number): number {
  return (value - from) / (to - from)
}

/** Clamp. motion-dom lacks it (it lives in the `motion` package). */
export function clampN(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value))
}
