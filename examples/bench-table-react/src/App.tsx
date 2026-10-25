import type { RowData } from './data'
// Cross-framework benchmark UI — ReactLynx variant, mirrors
// examples/bench-table operation-for-operation. Idiomatic keyed react-hooks
// implementation from js-framework-benchmark: immutable state updates +
// memoized row component (same shape as vue-lynx's ui-react twin).
import { memo, useCallback, useState } from '@lynx-js/react'

import { buildData } from './data'
import { INITIAL_ROWS } from './rows-config'
import { runTicks } from './task'

import './App.css'

const STORM_UPDATE_TICKS = 50
const STORM_SELECT_TICKS = 30

interface RowProps {
  row: RowData
  isSelected: boolean
  onSelect: (id: number) => void
  onRemove: (id: number) => void
}

const Row = memo(({ row, isSelected, onSelect, onRemove }: RowProps) => {
  return (
    <view class={isSelected ? 'row danger' : 'row'}>
      <text class="col-id">{row.id}</text>
      <text class="col-label" bindtap={() => onSelect(row.id)}>
        {row.label}
      </text>
      <text class="col-remove" bindtap={() => onRemove(row.id)}>
        x
      </text>
    </view>
  )
})

export function App() {
  const [rows, setRows] = useState<RowData[]>(() => buildData(INITIAL_ROWS))
  const [selected, setSelected] = useState<number | undefined>(undefined)

  const create1k = useCallback(() => {
    setRows(buildData())
    setSelected(undefined)
  }, [])
  const create10k = useCallback(() => {
    setRows(buildData(10000))
    setSelected(undefined)
  }, [])
  const append1k = useCallback(() => {
    setRows(prev => prev.concat(buildData(1000)))
  }, [])
  const update10th = useCallback(() => {
    setRows((prev) => {
      const next = prev.slice()
      for (let i = 0; i < next.length; i += 10)
        next[i] = { id: next[i].id, label: `${next[i].label} !!!` }
      return next
    })
  }, [])
  const swapRows = useCallback(() => {
    setRows((prev) => {
      if (prev.length <= 998)
        return prev
      const next = prev.slice()
      const a = next[1]
      next[1] = next[998]
      next[998] = a
      return next
    })
  }, [])
  const clear = useCallback(() => {
    setRows([])
    setSelected(undefined)
  }, [])
  const select = useCallback((id: number) => setSelected(id), [])
  const remove = useCallback((id: number) => {
    setRows((prev) => {
      const idx = prev.findIndex(d => d.id === id)
      if (idx < 0)
        return prev
      return prev.slice(0, idx).concat(prev.slice(idx + 1))
    })
  }, [])

  // Storms: each tick is its own task so every mutation goes through a full
  // render cycle instead of batching (mirrors the solid twin + vue-lynx).
  const stormUpdate = useCallback(() => {
    runTicks(STORM_UPDATE_TICKS, (t) => {
      setRows(prev =>
        prev.map((r, i) => (i % 10 === 0 ? { id: r.id, label: `bench ${t}` } : r)),
      )
    })
  }, [])
  const stormSelect = () => {
    runTicks(STORM_SELECT_TICKS, (t) => {
      const len = rows.length
      if (len === 0)
        return
      setSelected(t < STORM_SELECT_TICKS ? rows[(t * 97) % len].id : rows[0].id)
    })
  }

  return (
    <view class="page">
      <text class="title">React UI Benchmark on Lynx · ready</text>
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
        {rows.map(row => (
          <Row
            key={row.id}
            row={row}
            isSelected={selected === row.id}
            onSelect={select}
            onRemove={remove}
          />
        ))}
      </view>
    </view>
  )
}
