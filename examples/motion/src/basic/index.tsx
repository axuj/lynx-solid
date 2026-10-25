/**
 * Basic case — aligned with lynx-examples `Motion` Basic: auto-starts a
 * smooth scale+rotate reverse loop on the main thread (no tap needed).
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

function BasicCase() {
  const boxRef = useMainThreadRef<MainThread.Element | null>(null)
  const animateRef = useMainThreadRef<{ stop: () => void } | null>(null)

  function startAnimation() {
    'main thread'
    const el = boxRef.current
    if (!el)
      return
    // Explicit [from, to]: single-value keyframes force the engine to read
    // current styles via the global getComputedStyle, which rejects proxy
    // subjects on web hosts. Explicit frames never read. reverse-repeat
    // oscillates the same way the official target-object form does.
    animateRef.current = animateEl(
      el,
      { scale: [1.5, 0.4], rotate: ['0deg', '45deg'] },
      {
        ease: 'circInOut',
        duration: 1,
        repeat: Number.POSITIVE_INFINITY,
        repeatType: 'reverse',
      },
    )
  }

  // Mount → init on the main thread (mirrors official useEffect). Ref ops
  // from this tick ride the same batch as the worklet (flushNow), so no
  // settle delay is needed — same ordering as React's delayed payload.
  onSettled(() => {
    void runOnMainThread(startAnimation)()
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

render(() => <BasicCase />)
