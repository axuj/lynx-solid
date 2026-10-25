import { render } from '@lynx-solid/runtime'
import { createEffect, createMemo, createSignal, For } from 'solid-js'

function App() {
  const [names, setNames] = createSignal<string[]>(['Emil, Hans', 'Mustermann, Max', 'Tisch, Roman'])
  const [selected, setSelected] = createSignal(-1)
  const [prefix, setPrefix] = createSignal('')
  const [first, setFirst] = createSignal('')
  const [last, setLast] = createSignal('')

  const filteredNames = createMemo(() =>
    names()
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => name.toLowerCase().startsWith(prefix().toLowerCase())),
  )

  // Solid 2 two-arg form (same pattern as elk's CollectionPage): the first
  // fn tracks `selected`, the second applies it — mirrors vue's
  // `watch(selected, …)`.
  createEffect(
    () => selected(),
    (idx) => {
      const list = names()
      if (idx >= 0 && idx < list.length) {
        const parts = list[idx].split(', ')
        setLast(parts[0] || '')
        setFirst(parts[1] || '')
      }
    },
  )

  function create(): void {
    if (first().trim() && last().trim()) {
      const fullName = `${last()}, ${first()}`
      if (!names().includes(fullName)) {
        setNames(prev => [...prev, fullName])
        setFirst('')
        setLast('')
      }
    }
  }

  function update(): void {
    if (selected() >= 0 && first().trim() && last().trim()) {
      const idx = selected()
      setNames(prev => prev.map((n, i) => i === idx ? `${last()}, ${first()}` : n))
    }
  }

  function del(): void {
    if (selected() >= 0) {
      const idx = selected()
      setNames(prev => prev.filter((_, i) => i !== idx))
      setSelected(-1)
      setFirst('')
      setLast('')
    }
  }

  return (
    <view style={{ padding: '20px', gap: '12px' }}>
      {/* Filter */}
      <view style={{ gap: '4px' }}>
        <text style={{ fontSize: '12px', color: '#666' }}>Filter prefix:</text>
        <input
          type="text"
          value={prefix()}
          placeholder="Filter prefix"
          style={{ height: '36px', borderWidth: '1px', borderColor: '#ccc', borderRadius: '4px', padding: '0 8px', fontSize: '16px' }}
          bindinput={e => setPrefix(e.detail?.value ?? '')}
        />
      </view>

      {/* Name list */}
      <view style={{ borderWidth: '1px', borderColor: '#ccc', borderRadius: '4px', minHeight: '120px' }}>
        <For each={filteredNames()}>
          {item => (
            <view
              style={{ padding: '8px 12px', backgroundColor: selected() === item.index ? '#0077ff' : 'transparent' }}
              bindtap={() => setSelected(item.index)}
            >
              <text style={{ fontSize: '16px', color: selected() === item.index ? '#fff' : '#222' }}>
                {item.name}
              </text>
            </view>
          )}
        </For>
      </view>

      {/* Name / Surname inputs */}
      <view style={{ gap: '8px' }}>
        <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
          <text style={{ fontSize: '14px', width: '80px' }}>Name:</text>
          <input
            type="text"
            value={first()}
            style={{ flex: '1', height: '36px', borderWidth: '1px', borderColor: '#ccc', borderRadius: '4px', padding: '0 8px', fontSize: '16px' }}
            bindinput={e => setFirst(e.detail?.value ?? '')}
          />
        </view>
        <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
          <text style={{ fontSize: '14px', width: '80px' }}>Surname:</text>
          <input
            type="text"
            value={last()}
            style={{ flex: '1', height: '36px', borderWidth: '1px', borderColor: '#ccc', borderRadius: '4px', padding: '0 8px', fontSize: '16px' }}
            bindinput={e => setLast(e.detail?.value ?? '')}
          />
        </view>
      </view>

      {/* Action buttons */}
      <view style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
        <view
          style={{ padding: '8px 16px', backgroundColor: '#0077ff', borderRadius: '6px' }}
          bindtap={create}
        >
          <text style={{ color: '#fff', fontSize: '14px' }}>Create</text>
        </view>
        <view
          style={{ padding: '8px 16px', backgroundColor: selected() >= 0 ? '#0077ff' : '#ccc', borderRadius: '6px' }}
          bindtap={update}
        >
          <text style={{ color: '#fff', fontSize: '14px' }}>Update</text>
        </view>
        <view
          style={{ padding: '8px 16px', backgroundColor: selected() >= 0 ? '#ff4444' : '#ccc', borderRadius: '6px' }}
          bindtap={del}
        >
          <text style={{ color: '#fff', fontSize: '14px' }}>Delete</text>
        </view>
      </view>
    </view>
  )
}

render(() => <App />)
