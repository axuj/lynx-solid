import { render } from '@lynx-solid/runtime'
import { For, Show } from 'solid-js'

import { useInfiniteFeed } from '../shared/useInfiniteFeed'

import '../shared/styles.css'

function App() {
  const { items, loading, done, loadMore } = useInfiniteFeed(15)

  return (
    <view class="root">
      <view class="header">
        <text class="title">list · infinite</text>
        <text class="subtitle">
          `bindscrolltolower` drives a Solid helper. No virtual-scroller library
          — native recycling + reactive `items` is the design pattern.
        </text>
      </view>

      <list
        class="list"
        list-type="single"
        scroll-orientation="vertical"
        lower-threshold-item-count={3}
        bindscrolltolower={() => { void loadMore() }}
      >
        <For each={items()}>
          {item => (
            <list-item
              item-key={item.id}
              estimated-main-axis-size-px={96}
            >
              <view class="card">
                <text class="card-title">{item.title}</text>
                <text class="card-body">{item.body}</text>
              </view>
            </list-item>
          )}
        </For>

        <list-item item-key="__footer" estimated-main-axis-size-px={64}>
          <view class="footer-item">
            <text class="footer-text">
              <Show
                when={loading()}
                fallback={done() ? 'You reached the end' : 'Scroll for more'}
              >
                Loading more…
              </Show>
            </text>
          </view>
        </list-item>
      </list>
    </view>
  )
}

render(() => <App />)
