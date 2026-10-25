import { render } from '@lynx-solid/runtime'
import { createMemo, createSignal, For } from 'solid-js'

import '../shared/styles.css'

/**
 * Reorder stress — make the Solid truth vs native <list> mismatch obvious.
 *
 * Left/top strip is ordinary <view>s (always follows Solid). The <list> below
 * is what the MT adapter drives. After "Yellow → top" or "Reverse", the two
 * rows of colors must match. If the list keeps the old color order while the
 * truth strip flips, the list adapter lost the move.
 */
interface Tile {
  id: string
  label: string
  color: string
}

const INITIAL: Tile[] = [
  { id: 'R', label: 'RED', color: '#ef4444' },
  { id: 'B', label: 'BLUE', color: '#3b82f6' },
  { id: 'G', label: 'GREEN', color: '#22c55e' },
  { id: 'Y', label: 'YELLOW', color: '#eab308' },
]

function App() {
  const [items, setItems] = createSignal<Tile[]>([...INITIAL])

  const expectedTop = createMemo(() => items()[0]!)
  const expectedOrder = createMemo(() =>
    items().map(t => t.label).join(' → '),
  )

  function yellowToTop(): void {
    const list = items()
    const rest = list.filter(t => t.id !== 'Y')
    const yellow = list.find(t => t.id === 'Y')!
    setItems([yellow, ...rest])
  }

  function reverse(): void {
    setItems(prev => [...prev].reverse())
  }

  function reset(): void {
    setItems([...INITIAL])
  }

  return (
    <view class="root">
      <view class="header">
        <text class="title">list · reorder</text>
        <text class="subtitle">
          Compare the two color rows. Top = Solid truth (plain views). Bottom =
          native &lt;list&gt;. After a tap they must show the same order.
        </text>
      </view>

      <view class="toolbar">
        <view class="btn danger" bindtap={yellowToTop}>
          <text class="btn-text">Yellow → top</text>
        </view>
        <view class="btn danger" bindtap={reverse}>
          <text class="btn-text">Reverse</text>
        </view>
        <view class="btn" bindtap={reset}>
          <text class="btn-text">Reset</text>
        </view>
      </view>

      <view class="banner warn">
        <text class="banner-text">
          Expect list TOP cell =
          {' '}
          {expectedTop().label}
          {' '}
          · full order:
          {' '}
          {expectedOrder()}
        </text>
      </view>

      {/* Solid truth: not a list — always correct */}
      <view class="truth-block">
        <text class="truth-label">Solid truth (not list)</text>
        <view class="truth-row">
          <For each={items()}>
            {(tile, i) => (
              <view
                class="truth-chip"
                style={{ backgroundColor: tile.color }}
              >
                <text class="truth-chip-text">
                  {i() + 1}
                  .
                  {tile.label}
                </text>
              </view>
            )}
          </For>
        </view>
      </view>

      <text class="truth-label list-label">Native &lt;list&gt; (must match)</text>

      <list
        class="list reorder-list"
        list-type="single"
        scroll-orientation="vertical"
      >
        <For each={items()}>
          {(tile, index) => (
            <list-item
              item-key={tile.id}
              estimated-main-axis-size-px={88}
            >
              <view
                class="reorder-cell"
                style={{ backgroundColor: tile.color }}
              >
                <text class="reorder-cell-pos">
                  slot
                  {' '}
                  {index() + 1}
                </text>
                <text class="reorder-cell-label">{tile.label}</text>
                <text class="reorder-cell-hint">
                  {index() === 0
                    ? `← must be ${expectedTop().label}`
                    : `id=${tile.id}`}
                </text>
              </view>
            </list-item>
          )}
        </For>
      </list>
    </view>
  )
}

render(() => <App />)
