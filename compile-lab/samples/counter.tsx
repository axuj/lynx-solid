import { render } from '@lynx-solid/runtime'
import { createSignal, Show } from 'solid-js'

function App() {
  const [count, setCount] = createSignal(0)
  return (
    <view class="card">
      <text>
        count:
        {count()}
      </text>
      <Show when={count() > 0}>
        <text>positive</text>
      </Show>
      <view class="btn" bindtap={() => setCount(count() + 1)}>
        <text>+1</text>
      </view>
    </view>
  )
}

render(() => <App />)
