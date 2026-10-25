import { render } from '@lynx-solid/runtime'
/**
 * dev — keyed rows demo for @lynx-solid/runtime (dual-thread).
 *
 * The octane-bench-style workload: 1000 keyed rows, each with a row number,
 * a tappable label cell (selects the row) and a tappable remove cell.
 * Exercises the background-thread runtime end to end: JSX is compiled by
 * babel-preset-solid (universal mode) into renderer calls against our
 * solid-js/universal renderer, ops flow to the main-thread interpreter, and
 * tap events round-trip through the sign registry.
 */
import { createSignal, For } from 'solid-js'

import './index.css'

const ROWS = 1000

function RowsList() {
  const [selected, setSelected] = createSignal(0)
  const [rows, setRows] = createSignal<number[]>(Array.from({ length: ROWS }, (_, idx) => idx + 1))

  return (
    <view class="list">
      <For each={rows()}>
        {id => (
          <view class={selected() === id ? 'row selected' : 'row'} id={`row-${id}`}>
            <text class="cell-id">{id}</text>
            <view class="cell" bindtap={() => setSelected(id)}>
              <text class="cell-label">
                label-
                {id}
              </text>
            </view>
            <view class="cell" bindtap={() => setRows(r => r.filter(x => x !== id))}>
              <text class="cell-x">x</text>
            </view>
          </view>
        )}
      </For>
    </view>
  )
}

render(() => <RowsList />)
