import { render } from '@lynx-solid/runtime'
import { createSignal, createStore, For, Show } from 'solid-js'

const COLS = 5
const ROWS = 10

const cols = Array.from({ length: COLS }, (_, i) => String.fromCharCode(65 + i))
const rows = Array.from({ length: ROWS }, (_, i) => i)

function App() {
  // cells[col][row] = raw expression string
  const [cells, setCells] = createStore<string[][]>(
    Array.from({ length: COLS }, () => Array.from<string>({ length: ROWS }).fill('')),
  )

  const [editingCell, setEditingCell] = createSignal<{ c: number, r: number } | null>(null)
  const [editValue, setEditValue] = createSignal('')

  function getCellValue(c: number, r: number): number | string {
    const val = evalCell(cells[c][r])
    const num = Number(val)
    return Number.isFinite(num) ? num : val
  }

  function evalCell(exp: string): string {
    if (!exp || !exp.startsWith('='))
      return exp

    const replaced = exp
      .slice(1)
      .replace(/\b([A-Z])(\d{1,2})\b/g, (_, col: string, row: string) =>
        `get(${col.charCodeAt(0) - 65},${row})`)

    try {
      // eslint-disable-next-line no-new-func -- formula sandbox, same as the reference implementation
      return String(new Function('get', `return ${replaced}`)(getCellValue))
    }
    catch {
      return '#ERR'
    }
  }

  function startEdit(c: number, r: number): void {
    setEditingCell({ c, r })
    setEditValue(cells[c][r])
  }

  function finishEdit(e?: { detail?: { value?: string } }): void {
    const cell = editingCell()
    if (cell) {
      const value = (e?.detail?.value ?? editValue()).trim()
      setCells(prev => prev.map((col, ci) =>
        ci === cell.c ? col.map((v, ri) => ri === cell.r ? value : v) : col,
      ))
      setEditingCell(null)
    }
  }

  return (
    <view style={{ padding: '10px' }}>
      {/* Header row */}
      <view style={{ display: 'flex', flexDirection: 'row' }}>
        <view style={{ width: '30px', height: '28px', justifyContent: 'center', alignItems: 'center', backgroundColor: '#eee' }}>
          <text style={{ fontSize: '12px' }} />
        </view>
        <For each={cols}>
          {col => (
            <view
              style={{
                width: '70px',
                height: '28px',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: '#eee',
                borderWidth: '0.5px',
                borderColor: '#ccc',
              }}
            >
              <text style={{ fontSize: '13px', fontWeight: 'bold' }}>{col}</text>
            </view>
          )}
        </For>
      </view>

      {/* Data rows */}
      <For each={rows}>
        {r => (
          <view style={{ display: 'flex', flexDirection: 'row' }}>
            {/* Row header */}
            <view style={{ width: '30px', height: '28px', justifyContent: 'center', alignItems: 'center', backgroundColor: '#eee', borderWidth: '0.5px', borderColor: '#ccc' }}>
              <text style={{ fontSize: '12px' }}>{r}</text>
            </view>
            {/* Cells */}
            <For each={cols}>
              {(col, c) => {
                const editing = () => {
                  const cell = editingCell()
                  return cell !== null && cell.c === c() && cell.r === r
                }
                return (
                  <view
                    style={{ width: '70px', height: '28px', borderWidth: '0.5px', borderColor: '#ccc', justifyContent: 'center' }}
                    bindtap={() => startEdit(c(), r)}
                  >
                    <Show
                      when={editing()}
                      fallback={(
                        <text style={{ fontSize: '13px', padding: '0 4px' }}>
                          {evalCell(cells[c()][r])}
                        </text>
                      )}
                    >
                      <input
                        type="text"
                        value={editValue()}
                        style={{ height: '28px', fontSize: '13px', padding: '0 4px' }}
                        bindinput={e => setEditValue(e.detail?.value ?? '')}
                        bindconfirm={finishEdit}
                        bindblur={finishEdit}
                      />
                    </Show>
                  </view>
                )
              }}
            </For>
          </view>
        )}
      </For>

      <text style={{ marginTop: '12px', fontSize: '12px', color: '#999' }}>
        Tap a cell to edit. Use =A0+B1 for formulas.
      </text>
    </view>
  )
}

render(() => <App />)
