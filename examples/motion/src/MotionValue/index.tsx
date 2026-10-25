import type { MainThread } from '@lynx-js/types'
/**
 * MotionValue case — aligned with lynx-examples `Motion` MotionValue:
 * a shared MotionValue is driven by `animate(mv, [0.8, 1.4], reverse)`
 * in an infinite reverse loop; the `change` subscription writes scale.
 * Auto-starts on mount (mirrors official useEffect); ref ops ship in the
 * same batch as the worklet — no settle delay.
 *
 * Eval order (runtime → shim → motion-dom) is structural: runtime first
 * (its queue-microtask-shim mounts the engine-backed global on BG), then
 * every module that value-imports `motion-dom` carries its own frozen bare
 * `./shim-entry` import (see `adapters/motion.ts`) — motion-dom bare-reads
 * `queueMicrotask` at module eval for its microtask batcher; this file's
 * import order is free.
 */
import type { MotionValue } from 'motion-dom'
import { render, runOnMainThread, useMainThreadRef } from '@lynx-solid/runtime'
import { onSettled } from 'solid-js'
import { animateMv, motionValue } from '../adapters' with { runtime: 'shared' }
import { ThemeFrame } from '../shared/ThemeFrame'

import './styles.css'

function MotionValueCase() {
  const boxRef = useMainThreadRef<MainThread.Element | null>(null)
  const valueRef = useMainThreadRef<MotionValue<number> | null>(null)
  const animateRef = useMainThreadRef<{ stop: () => void } | null>(null)

  function startAnimation() {
    'main thread'
    if (!valueRef.current)
      valueRef.current = motionValue(0.5)
    const box = boxRef.current
    const mv = valueRef.current
    if (!box || !mv)
      return
    mv.on('change', (v) => {
      box.setStyleProperties({ transform: `scale(${v})` })
    })
    animateRef.current = animateMv(mv, [0.8, 1.4], {
      duration: 1,
      repeat: Number.POSITIVE_INFINITY,
      repeatType: 'reverse',
    })
  }

  // Mount → init on the main thread (mirrors official useEffect). Ref ops
  // ride the same batch as the worklet — no settle delay.
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

render(() => <MotionValueCase />)
