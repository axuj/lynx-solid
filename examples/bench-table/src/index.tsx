import type { RowData } from './data'
import { render } from '@lynx-solid/runtime'
import { createSignal, createStore, For } from 'solid-js'
import { buildData, buildDataSeeded } from './data'
import { INITIAL_ROWS } from './rows-config'
import { runTicks } from './task'

import './bench.css'

const STORM_UPDATE_TICKS = 50
const STORM_SELECT_TICKS = 30

function Row(props: {
  row: RowData
  isSelected: () => boolean
  onSelect: (id: number) => void
  onRemove: (id: number) => void
}) {
  return (
    <view class={props.isSelected() ? 'row danger' : 'row'}>
      <text class="col-id">{String(props.row.id)}</text>
      <text class="col-label" bindtap={() => props.onSelect(props.row.id)}>
        {props.row.label}
      </text>
      <text class="col-remove" bindtap={() => props.onRemove(props.row.id)}>
        x
      </text>
    </view>
  )
}

function BenchApp() {
  // First-screen row count, set at BUILD time by src/rows-config.ts so the
  // benchmark sweep can vary it. Default 0 = the original empty first screen.
  const [rows, setRows] = createStore<RowData[]>(buildDataSeeded(INITIAL_ROWS, 42))
  const [selected, setSelected] = createSignal<number | undefined>(undefined)

  // Structure rebuilds — return form (shallow replace is correct when the
  // whole row set is new) or draft mutations; keyed survival is by object
  // identity inside the store, no reconcile needed.
  const create1k = () => {
    setRows(() => buildData())
    setSelected(undefined)
  }
  const create10k = () => {
    setRows(() => buildData(10000))
    setSelected(undefined)
  }
  const append1k = () => {
    setRows((s) => {
      s.push(...buildData(1000))
    })
  }
  const update10th = () => {
    setRows((s) => {
      for (let i = 0; i < s.length; i += 10)
        s[i].label = `${s[i].label} !!!`
    })
  }
  const swapRows = () => {
    setRows((s) => {
      if (s.length <= 998)
        return
      const a = s[1]
      s[1] = s[998]
      s[998] = a
    })
  }
  const clear = () => {
    setRows(() => [])
    setSelected(undefined)
  }
  const selectRow = (id: number) => setSelected(id)
  const removeRow = (id: number) => {
    setRows(s => s.filter(r => r.id !== id))
  }

  // Storms: each tick is its own task so every mutation goes through a full
  // render cycle instead of batching (mirrors ui-react/ui-vdom semantics).
  const stormUpdate = () =>
    runTicks(STORM_UPDATE_TICKS, (t) => {
      setRows((s) => {
        for (let i = 0; i < s.length; i += 10)
          s[i].label = `bench ${t}`
      })
    })
  const stormSelect = () => {
    // Read ids at click time (event handler) — rows never change during the
    // select storm, so a plain snapshot avoids untracked store reads inside
    // the async tick callbacks.
    const ids: number[] = []
    for (let i = 0; i < rows.length; i++)
      ids.push(rows[i].id)
    runTicks(STORM_SELECT_TICKS, (t) => {
      const len = ids.length
      if (len === 0)
        return
      setSelected(t < STORM_SELECT_TICKS ? ids[(t * 97) % len] : ids[0])
    })
  }

  return (
    <view class="page">
      <text class="title">Solid UI Benchmark on Lynx · ready</text>
      <view class="toolbar">
        <view class="btn" bindtap={create1k}>
          <text class="btn-text">Create 1,000 rows</text>
        </view>
        <view class="btn" bindtap={create10k}>
          <text class="btn-text">Create 10,000 rows</text>
        </view>
        <view class="btn" bindtap={append1k}>
          <text class="btn-text">Append 1,000 rows</text>
        </view>
        <view class="btn" bindtap={update10th}>
          <text class="btn-text">Update every 10th row</text>
        </view>
        <view class="btn" bindtap={swapRows}>
          <text class="btn-text">Swap Rows</text>
        </view>
        <view class="btn" bindtap={clear}>
          <text class="btn-text">Clear</text>
        </view>
        <view class="btn" bindtap={stormUpdate}>
          <text class="btn-text">Update storm</text>
        </view>
        <view class="btn" bindtap={stormSelect}>
          <text class="btn-text">Select storm</text>
        </view>
      </view>
      <view class="rows">
        <For each={rows}>
          {row => (
            <Row
              row={row}
              isSelected={() => selected() === row.id}
              onSelect={selectRow}
              onRemove={removeRow}
            />
          )}
        </For>
      </view>
    </view>
  )
}

render(() => <BenchApp />)
