import { render } from '@lynx-solid/runtime'
import { createSignal } from 'solid-js'

function App() {
  const [celsius, setCelsius] = createSignal('0')
  const [fahrenheit, setFahrenheit] = createSignal('32')

  function onCelsiusInput(e: { detail?: { value?: string } }): void {
    const val = e.detail?.value ?? ''
    // Engine quirk: the device echoes our own setValue back as an input
    // event (web never does). Same value = our own write, nothing to do —
    // without this early return the cross-round-trip below overwrites live
    // typing (2 → -16.67 → 1.99). Upstream: lynx setValue-echo issue.
    if (val === celsius())
      return
    setCelsius(val)
    const num = Number(val)
    if (Number.isFinite(num)) {
      setFahrenheit(String(+(num * (9 / 5) + 32).toFixed(2)))
    }
  }

  function onFahrenheitInput(e: { detail?: { value?: string } }): void {
    const val = e.detail?.value ?? ''
    // Same engine-echo guard as onCelsiusInput.
    if (val === fahrenheit())
      return
    setFahrenheit(val)
    const num = Number(val)
    if (Number.isFinite(num)) {
      setCelsius(String(+((num - 32) * (5 / 9)).toFixed(2)))
    }
  }

  return (
    <view style={{ display: 'flex', padding: '20px', flexDirection: 'row', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <input
        type="text"
        value={celsius()}
        style={{ width: '100px', height: '36px', borderWidth: '1px', borderColor: '#ccc', borderRadius: '4px', padding: '0 8px', fontSize: '16px' }}
        bindinput={onCelsiusInput}
      />
      <text style={{ fontSize: '16px' }}>Celsius =</text>
      <input
        type="text"
        value={fahrenheit()}
        style={{ width: '100px', height: '36px', borderWidth: '1px', borderColor: '#ccc', borderRadius: '4px', padding: '0 8px', fontSize: '16px' }}
        bindinput={onFahrenheitInput}
      />
      <text style={{ fontSize: '16px' }}>Fahrenheit</text>
    </view>
  )
}

render(() => <App />)
