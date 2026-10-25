import { render } from '@lynx-solid/runtime'
import { createSignal, For } from 'solid-js'

function App() {
  const [items, setItems] = createSignal<string[]>(['a', 'b', 'c'])
  return (
    <view style="width:100%;height:100%;background:#fff">
      <scroll-view scroll-y style="width:100%;height:80%">
        <For each={items()}>
          {item => (
            <view
              style="height:60px;justify-content:center;padding-left:16px;border-bottom:1px solid #eee"
            >
              <text>{item}</text>
            </view>
          )}
        </For>
      </scroll-view>
      <view
        bindtap={() => setItems(v => [...v, `item ${v.length}`])}
        style="height:60px;background:lightgreen;justify-content:center;align-items:center"
      >
        <text>add item</text>
      </view>
    </view>
  )
}

render(() => <App />)
