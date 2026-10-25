import { render } from '@lynx-solid/runtime'
import { createSignal } from 'solid-js'

function App() {
  const [count, setCount] = createSignal(0)

  return (
    <view style={{ display: 'flex', padding: '20px', flexDirection: 'row', alignItems: 'center', gap: '12px' }}>
      <text style={{ fontSize: '24px', minWidth: '60px' }}>{count()}</text>
      <view
        style={{ padding: '8px 20px', backgroundColor: '#0077ff', borderRadius: '6px' }}
        bindtap={() => setCount(c => c + 1)}
      >
        <text style={{ color: '#fff', fontSize: '16px' }}>Count</text>
      </view>
    </view>
  )
}

render(() => <App />)
