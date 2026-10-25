import type { Card } from '../shared/data'

import { render } from '@lynx-solid/runtime'
import { createSignal, For } from 'solid-js'
import { makeCards } from '../shared/data'

import '../shared/styles.css'

function App() {
  /**
   * Remove + Reset with the *same* item-keys.
   *
   * Reset re-inserts Row-1…N and the native list must not throw duplicated
   * item-key (2202) — Reset is the intentional repro / regression check.
   */
  const [items, setItems] = createSignal<Card[]>(makeCards(12, 'Row'))
  const [lastAction, setLastAction] = createSignal('—')

  function removeMiddle(): void {
    const list = items()
    if (list.length < 2)
      return
    const mid = Math.floor(list.length / 2)
    const removed = list[mid]!
    setItems([
      ...list.slice(0, mid),
      ...list.slice(mid + 1),
    ])
    setLastAction(`removed middle ${removed.title}`)
  }

  function removeTail(): void {
    const list = items()
    if (list.length === 0)
      return
    const removed = list[list.length - 1]!
    setItems(list.slice(0, -1))
    setLastAction(`removed last ${removed.title}`)
  }

  function reset(): void {
    // Same ids on purpose — must not 2202 after removes.
    setItems(makeCards(12, 'Row'))
    setLastAction('reset (same item-keys)')
  }

  return (
    <view class="root">
      <view class="header">
        <text class="title">list · remove + reset</text>
        <text class="subtitle">
          Remove some rows, then Reset. Reset rebuilds Row-1…12 with the same
          item-keys. A duplicated item-key toast means the MT adapter forgot to
          emit removeAction (impl bug — not a flaky demo).
        </text>
      </view>

      <view class="toolbar">
        <view class="btn" bindtap={removeMiddle}>
          <text class="btn-text">Remove middle</text>
        </view>
        <view class="btn" bindtap={removeTail}>
          <text class="btn-text">Remove last</text>
        </view>
        <view class="btn danger" bindtap={reset}>
          <text class="btn-text">Reset same keys</text>
        </view>
      </view>

      <view class="banner ok-banner">
        <text class="banner-text ok-text">
          Solid length=
          {items().length}
          {' '}
          · last:
          {' '}
          {lastAction()}
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
