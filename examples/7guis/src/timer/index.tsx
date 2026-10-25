import { render } from '@lynx-solid/runtime'
import { createMemo, createSignal, onCleanup } from 'solid-js'

function App() {
  const [duration, setDuration] = createSignal(15000) // ms
  const [elapsed, setElapsed] = createSignal(0)

  let lastTime = Date.now()
  const interval = setInterval(() => {
    const now = Date.now()
    const dt = now - lastTime
    lastTime = now
    if (elapsed() < duration()) {
      setElapsed(prev => Math.min(prev + dt, duration()))
    }
  }, 50)

  onCleanup(() => clearInterval(interval))

  const progressPct = createMemo(() =>
    Math.min(elapsed() / duration(), 1) * 100,
  )

  function reset(): void {
    setElapsed(0)
    lastTime = Date.now()
  }

  function adjustDuration(delta: number): void {
    setDuration(prev => Math.max(1000, Math.min(30000, prev + delta)))
  }

  return (
    <view style={{ padding: '20px', gap: '14px' }}>
      {/* Progress bar */}
      <view style={{ gap: '4px' }}>
        <text style={{ fontSize: '14px', color: '#666' }}>Elapsed Time:</text>
        <view style={{ height: '20px', backgroundColor: '#eee', borderRadius: '4px', overflow: 'hidden' }}>
          <view
            style={{ height: '20px', width: `${progressPct()}%`, backgroundColor: '#0077ff', borderRadius: '4px' }}
          />
        </view>
      </view>

      <text style={{ fontSize: '20px' }}>
        {(elapsed() / 1000).toFixed(1)}
        s
      </text>

      {/* Duration control */}
      <view style={{ gap: '4px' }}>
        <text style={{ fontSize: '14px', color: '#666' }}>
          Duration:
          {' '}
          {(duration() / 1000).toFixed(1)}
          s
        </text>
        <view style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
          <view
            style={{ padding: '6px 16px', backgroundColor: '#eee', borderRadius: '4px' }}
            bindtap={() => adjustDuration(-1000)}
          >
            <text style={{ fontSize: '16px' }}>-1s</text>
          </view>
          <view
            style={{ padding: '6px 16px', backgroundColor: '#eee', borderRadius: '4px' }}
            bindtap={() => adjustDuration(1000)}
          >
            <text style={{ fontSize: '16px' }}>+1s</text>
          </view>
        </view>
      </view>

      {/* Reset */}
      <view
        style={{ padding: '10px 20px', backgroundColor: '#0077ff', borderRadius: '6px', alignSelf: 'flex-start' }}
        bindtap={reset}
      >
        <text style={{ color: '#fff', fontSize: '16px' }}>Reset</text>
      </view>
    </view>
  )
}

render(() => <App />)
