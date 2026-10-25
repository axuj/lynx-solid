import { render } from '@lynx-solid/runtime'
import { For } from 'solid-js'

import { makeCards } from '../shared/data'

import '../shared/styles.css'

function App() {
  const tiles = makeCards(40, 'Tile')

  return (
    <view class="root">
      <view class="header">
        <text class="title">list · waterfall</text>
        <text class="subtitle">
          scroll-view is linear only. list unlocks flow / waterfall layouts
          while components stay ordinary functions inside each list-item.
        </text>
      </view>

      <list
        class="list"
        list-type="waterfall"
        span-count={2}
        scroll-orientation="vertical"
      >
        <For each={tiles}>
          {tile => (
            <list-item
              item-key={tile.id}
              estimated-main-axis-size-px={tile.height}
            >
              <view
                class="tile"
                style={{ height: `${tile.height}px`, backgroundColor: tile.color }}
              >
                <text class="tile-label">{tile.title}</text>
                <text class="tile-meta">
                  {tile.height}
                  px tall
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
