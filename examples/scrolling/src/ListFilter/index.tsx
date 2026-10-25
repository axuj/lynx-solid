import { render } from '@lynx-solid/runtime'
import { createMemo, createSignal, For } from 'solid-js'

import { makeCards } from '../shared/data'

import '../shared/styles.css'

function App() {
  /**
   * Regression check: filter / toggle a subset.
   *
   * Empirically looks correct on device. Keep as a smoke test (toggle twice and
   * confirm length 16 → 8 → 16 with no ghosts).
   */
  const all = makeCards(16, 'Row')
  const [onlyEven, setOnlyEven] = createSignal(false)

  const items = createMemo(() =>
    onlyEven()
      ? all.filter((_, i) => (i + 1) % 2 === 0)
      : all,
  )

  return (
    <view class="root">
      <view class="header">
        <text class="title">list · filter (smoke)</text>
        <text class="subtitle">
          Toggle even-only, then show all again. Length should be 16 → 8 → 16
          with no leftover rows. Treated as OK in practice; kept for regression.
        </text>
      </view>

      <view class="toolbar">
        <view class="btn" bindtap={() => setOnlyEven(v => !v)}>
          <text class="btn-text">
            {onlyEven() ? 'Show all (16)' : 'Even only (8)'}
          </text>
        </view>
        <view class="btn" bindtap={() => setOnlyEven(false)}>
          <text class="btn-text">Reset</text>
        </view>
      </view>

      <view class="banner ok-banner">
        <text class="banner-text ok-text">
          Filter=
          {onlyEven() ? 'even' : 'all'}
          {' '}
          · Signal length=
          {items().length}
        </text>
      </view>

      <list
        class="list"
        list-type="single"
        scroll-orientation="vertical"
      >
        <For each={items()}>
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
