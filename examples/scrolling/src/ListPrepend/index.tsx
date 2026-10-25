import type { Card } from '../shared/data'

import { render } from '@lynx-solid/runtime'
import { createMemo, createSignal, For } from 'solid-js'
import { makeCards } from '../shared/data'

import '../shared/styles.css'

function App() {
  /**
   * Prepend vs append — INSERT now respects the list anchor.
   * Top cell must become the red NEW card after Prepend.
   */
  const initialCards = makeCards(6, 'Row')
  const [items, setItems] = createSignal<Card[]>(initialCards)
  let seq = initialCards.length

  const topTitle = createMemo(() => items()[0]?.title ?? '(empty)')

  function prepend(): void {
    seq += 1
    const card: Card = {
      id: `Row-new-${seq}`,
      title: `NEW ${seq}`,
      body: 'Must be the FIRST (top) cell after prepend.',
      color: '#ef4444',
      height: 96,
    }
    setItems(prev => [card, ...prev])
  }

  function append(): void {
    seq += 1
    const card: Card = {
      id: `Row-tail-${seq}`,
      title: `TAIL ${seq}`,
      body: 'Append lands at the bottom.',
      color: '#10b981',
      height: 96,
    }
    setItems(prev => [...prev, card])
  }

  function reset(): void {
    const fresh = makeCards(6, 'Row')
    setItems(fresh)
    // read the local, not items(): writes are batched, so items() would
    // still return the pre-reset list and seq would resume from it
    seq = fresh.length
  }

  return (
    <view class="root">
      <view class="header">
        <text class="title">list · prepend</text>
        <text class="subtitle">
          Tap Prepend — the TOP list cell must turn red and read
          "NEW …". Append is the control that lands at the bottom.
        </text>
      </view>

      <view class="toolbar">
        <view class="btn danger" bindtap={prepend}>
          <text class="btn-text">Prepend</text>
        </view>
        <view class="btn ok" bindtap={append}>
          <text class="btn-text">Append</text>
        </view>
        <view class="btn" bindtap={reset}>
          <text class="btn-text">Reset</text>
        </view>
      </view>

      <view class="banner ok-banner">
        <text class="banner-text ok-text">
          Solid says TOP =
          {' '}
          {topTitle()}
        </text>
      </view>

      <view class="truth-block">
        <text class="truth-label">Solid truth · first item</text>
        <view
          class="truth-chip wide"
          style={{ backgroundColor: items()[0]?.color ?? '#9ca3af' }}
        >
          <text class="truth-chip-text">{topTitle()}</text>
        </view>
      </view>

      <list
        class="list"
        list-type="single"
        scroll-orientation="vertical"
      >
        <For each={items()}>
          {(card, index) => (
            <list-item
              item-key={card.id}
              estimated-main-axis-size-px={96}
            >
              <view
                class="card"
                style={{ borderLeftWidth: '6px', borderLeftColor: card.color, backgroundColor: index() === 0 ? '#fef2f2' : '#ffffff' }}
              >
                <text class="card-title">
                  {index() === 0 ? 'TOP · ' : ''}
                  {card.title}
                </text>
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
