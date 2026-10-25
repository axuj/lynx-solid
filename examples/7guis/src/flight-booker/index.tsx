import { render } from '@lynx-solid/runtime'
import { createMemo, createSignal, Show } from 'solid-js'

function dateToString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function App() {
  const [isReturn, setIsReturn] = createSignal(false)
  const today = dateToString(new Date())
  const [departureDate, setDepartureDate] = createSignal(today)
  const [returnDate, setReturnDate] = createSignal(today)

  const canBook = createMemo(
    () => !isReturn() || returnDate() > departureDate(),
  )

  function book(): void {
    if (isReturn()) {
      console.log(`Booked return flight: depart ${departureDate()}, return ${returnDate()}`)
    }
    else {
      console.log(`Booked one-way flight: depart ${departureDate()}`)
    }
  }

  return (
    <view style={{ padding: '20px', gap: '12px' }}>
      {/* Flight type toggle (simulated select) */}
      <view
        style={{ padding: '8px 16px', backgroundColor: '#eee', borderRadius: '6px' }}
        bindtap={() => setIsReturn(v => !v)}
      >
        <text style={{ fontSize: '16px' }}>{isReturn() ? 'Return Flight' : 'One-way Flight'}</text>
      </view>

      {/* Departure date */}
      <view style={{ gap: '4px' }}>
        <text style={{ fontSize: '12px', color: '#666' }}>Departure (YYYY-MM-DD)</text>
        <input
          type="text"
          value={departureDate()}
          style={{ height: '36px', borderWidth: '1px', borderColor: '#ccc', borderRadius: '4px', padding: '0 8px', fontSize: '16px' }}
          bindinput={e => setDepartureDate(e.detail?.value ?? '')}
        />
      </view>

      {/* Return date */}
      <view style={{ gap: '4px', opacity: isReturn() ? 1 : 0.4 }}>
        <text style={{ fontSize: '12px', color: '#666' }}>Return (YYYY-MM-DD)</text>
        <input
          type="text"
          value={returnDate()}
          style={{ height: '36px', borderWidth: '1px', borderColor: isReturn() ? '#ccc' : '#eee', borderRadius: '4px', padding: '0 8px', fontSize: '16px' }}
          bindinput={(e) => {
            if (isReturn())
              setReturnDate(e.detail?.value ?? '')
          }}
        />
      </view>

      {/* Book button */}
      <view
        style={{ padding: '10px 20px', backgroundColor: canBook() ? '#0077ff' : '#ccc', borderRadius: '6px', alignSelf: 'flex-start' }}
        bindtap={() => {
          if (canBook())
            book()
        }}
      >
        <text style={{ color: '#fff', fontSize: '16px' }}>Book</text>
      </view>

      <Show when={!canBook()}>
        <text style={{ color: 'red', fontSize: '14px' }}>
          Return date must be after departure date.
        </text>
      </Show>
    </view>
  )
}

render(() => <App />)
