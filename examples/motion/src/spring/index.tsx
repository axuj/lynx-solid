/**
 * Spring case — aligned with lynx-examples `Motion` Spring: auto-starts
 * an engine-owned spring rotate loop on the main thread (no tap needed).
 * Uses `animateEl` with `type: 'spring'` — the frame loop stays inside
 * motion-dom / the engine. Starts on `onSettled` (same as Basic); the
 * official's 1000ms delay is only for Lynx for Web ref readiness, not
 * needed on device once SET_MT_REF and the worklet share one flush.
 *
 * Eval order (runtime → shim → motion-dom) is structural: runtime first
 * (its queue-microtask-shim mounts the engine-backed global on BG), then
 * every module that value-imports `motion-dom` carries its own frozen bare
 * `./shim-entry` import (see `adapters/motion.ts`) — this file's import
 * order is free.
 */
import type { MainThread } from '@lynx-js/types'
import { render, runOnMainThread, useMainThreadRef } from '@lynx-solid/runtime'
import { onSettled } from 'solid-js'
import { animateEl } from '../adapters' with { runtime: 'shared' }
import { ThemeFrame } from '../shared/ThemeFrame'

import './styles.css'

function SpringCase() {
  const boxRef = useMainThreadRef<MainThread.Element | null>(null)
  const animateRef = useMainThreadRef<{ stop: () => void } | null>(null)

  function startAnimation() {
    'main thread'
    const el = boxRef.current
    if (!el)
      return
    // Explicit [0, 90]: same spring-loop as official `{ rotate: 90 }` target
    // form, without effect.read → getComputedStyle (rejects proxy subjects
    // on web hosts).
    animateRef.current = animateEl(
      el,
      { rotate: [0, 90] },
      {
        type: 'spring',
        repeat: Number.POSITIVE_INFINITY,
        repeatDelay: 0.2,
      },
    )
  }

  function endAnimation() {
    'main thread'
    animateRef.current?.stop()
  }

  // Mount → init on the main thread (mirrors official useEffect + Basic).
  // Ref ops ride the same batch as the worklet (flushNow) — no delay needed.
  onSettled(() => {
    void runOnMainThread(startAnimation)()
    return () => {
      void runOnMainThread(endAnimation)()
    }
  })

  return (
    <ThemeFrame>
      <view class="case-container">
        <view
          class="motion-box"
          main-thread:ref={boxRef}
        />
      </view>
    </ThemeFrame>
  )
}

render(() => <SpringCase />)
