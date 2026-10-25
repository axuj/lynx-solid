import { render } from '@lynx-solid/runtime'
import { For } from 'solid-js'

import { makeCards } from '../shared/data'

import '../shared/styles.css'

function App() {
  // Native list lazily attaches visible cells. Keep `key` === `item-key`.
  const cards = makeCards(80, 'Row')

  return (
    <view class="root">
      <view class="header">
        <text class="title">list · single</text>
        <text class="subtitle">
          Only visible rows are materialized. `&lt;For&gt;` tracks rows by identity;
          pass a stable Lynx `item-key` on every list-item.
        </text>
      </view>

      <list
        class="list"
        list-type="single"
        scroll-orientation="vertical"
      >
        <For each={cards}>
          {card => (
            <list-item
              item-key={card.id}
              estimated-main-axis-size-px={96}
            >
              <view class="card">
                <text class="card-title">{card.title}</text>
                <text class="card-body">{card.body}</text>
              </view>
            </list-item>
          )}
        </For>
      </list>
    </view>
  )
}

render(() => <App />)
