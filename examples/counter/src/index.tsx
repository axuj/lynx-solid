import { render } from '@lynx-solid/runtime'
import { createSignal } from 'solid-js'

function Counter() {
  const [count, setCount] = createSignal(0)

  return (
    <view style={{ display: 'linear', linearDirection: 'column', alignItems: 'center', padding: '48px' }}>
      <text style={{ fontSize: '28px' }}>
        count:
        {count()}
      </text>
      <view
        bindtap={() => setCount(c => c + 1)}
        style={{ marginTop: '24px', padding: '12px 32px', backgroundColor: '#2c4f7c', borderRadius: '8px' }}
      >
        <text style={{ color: '#ffffff', fontSize: '20px' }}>increment</text>
      </view>
    </view>
  )
}

render(() => <Counter />)
