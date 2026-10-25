import type { MainThread } from '@lynx-js/types'
/**
 * iOSSlider case — faithful port of lynx-examples `Motion` iOSSlider.
 * Touch-draggable pad: touch handlers drive a shared MotionValue, three
 * `styleEffect` bindings derive visuals (pad shift/squash, indicator
 * stretch, dot counter-scale). Overscroll snaps back via spring.
 * Differences vs official: `useMotionValueRef` replaced with worklet-side
 * creation + ref holding; `progress`/`clamp` are two-line locals
 * (motion-dom lacks them — they live in the `motion` package, which needs
 * React peers). String selectors match official iOSSlider; the extra
 * `.pct` text is this demo's brightness readout (official has none).
 *
 * Eval order (shim → motion-dom) is structural: every module that
 * value-imports `motion-dom` carries its own frozen bare `./shim-entry`
 * import (see `adapters/motion.ts`) — this file's import order is free.
 */
import type { MotionValue } from 'motion-dom'
import { render, runOnMainThread, useMainThreadRef } from '@lynx-solid/runtime'
import { onSettled } from 'solid-js'
import {
  calcProgress,
  clampN,
  mapValue,
  mix,
  motionValue,
  springValueTo,
  styleEffect,
  transformValue,
} from '../adapters' with { runtime: 'shared' }

import sunPng from './sun.png'
import './styles.css'

// Official shape is `e.detail.y` (MainThread.TouchEvent). Web hosts and
// some engine paths deliver the touches array instead — same dual-read
// as examples/elk Sheet. Prefer detail, fall back to touches. Inlined in
// both handlers (no shared helper): worklet-to-worklet local calls are
// not on the proven path.
interface LynxTouch {
  identifier?: number
  clientX?: number
  clientY?: number
  x?: number
  y?: number
}
interface LynxTouchEvent {
  detail?: { x?: number, y?: number }
  touches?: LynxTouch[]
}

const maxPull = 20
const maxSquish = 0.92
const maxStretch = 1.08

function SliderCase() {
  const sliderRef = useMainThreadRef<MainThread.Element | null>(null)
  const progressRef = useMainThreadRef<MotionValue<number> | null>(null)
  const sizeRef = useMainThreadRef({ top: 0, bottom: 0 })
  const initialDragYRef = useMainThreadRef(0)
  const initialProgressYRef = useMainThreadRef(0)
  const pctRef = useMainThreadRef<MainThread.Element | null>(null)

  function initEffects() {
    'main thread'
    if (!progressRef.current)
      progressRef.current = motionValue(0.5)
    pctRef.current?.setAttribute(
      'text',
      `${(progressRef.current.get() * 100).toFixed(1)}%`,
    )
    const slider = sliderRef.current
    if (slider) {
      void slider.invoke('boundingClientRect').then((res: { top: number, bottom: number }) => {
        sizeRef.current = { top: res.top, bottom: res.bottom }
      }).catch(() => {})
    }
    const mv = progressRef.current
    if (!mv)
      return
    mv.on('change', (v) => {
      pctRef.current?.setAttribute('text', `${(v * 100).toFixed(1)}%`)
    })
    const y = mapValue(mv, [-1, 0, 1, 2], [maxPull, 0, 0, -maxPull])
    const scaleX = mapValue(y, [-maxPull, 0, 0, maxPull], [maxSquish, 1, 1, maxSquish])
    const scaleY = mapValue(y, [-maxPull, 0, 0, maxPull], [maxStretch, 1, 1, maxStretch])
    styleEffect('.slider', { y, scaleX, scaleY })
    styleEffect('.indicator', {
      scaleY: transformValue(() => clampN(0, 1, progressRef.current?.get() ?? 0.5)),
    })
    const invertScaleX = transformValue(() => 1 / scaleX.get())
    const invertScaleY = transformValue(() => 1 / scaleY.get())
    styleEffect('.icon-container', { scaleX: invertScaleX, scaleY: invertScaleY })
  }

  function onTouchStart(event: LynxTouchEvent) {
    'main thread'
    progressRef.current?.stop()
    const detailY = event.detail?.y
    if (typeof detailY === 'number') {
      initialDragYRef.current = detailY
    }
    else {
      const first = event.touches?.[0]
      initialDragYRef.current = first?.clientY ?? first?.y ?? 0
    }
    const size = sizeRef.current
    const mv = progressRef.current
    if (mv)
      initialProgressYRef.current = mix(size.bottom, size.top, mv.get())
  }

  function onTouchMove(event: LynxTouchEvent) {
    'main thread'
    let y: number
    const detailY = event.detail?.y
    if (typeof detailY === 'number') {
      y = detailY
    }
    else {
      const first = event.touches?.[0]
      y = first?.clientY ?? first?.y ?? 0
    }
    const dragOffset = y - initialDragYRef.current
    const newProgressY = initialProgressYRef.current + dragOffset
    const size = sizeRef.current
    const next = calcProgress(size.bottom, size.top, newProgressY)
    progressRef.current?.set(next)
  }

  function onTouchEnd() {
    'main thread'
    const mv = progressRef.current
    if (!mv)
      return
    if (mv.get() < 0)
      springValueTo(mv, 0)
    else if (mv.get() > 1)
      springValueTo(mv, 1)
  }

  // Mount → init on the main thread (mirrors official useEffect). Ref ops
  // ride the same batch as the worklet — no settle delay needed.
  onSettled(() => {
    void runOnMainThread(initEffects)()
  })

  return (
    <view class="case-container">
      <text class="pct" main-thread:ref={pctRef}>50%</text>
      <view
        class="slider"
        main-thread:bindtouchend={onTouchEnd}
        main-thread:bindtouchmove={onTouchMove}
        main-thread:bindtouchstart={onTouchStart}
        main-thread:ref={sliderRef}
      >
        <view class="indicator" />
        <view class="icon-container">
          <image class="icon" src={sunPng} />
        </view>
      </view>
    </view>
  )
}

render(() => <SliderCase />)
