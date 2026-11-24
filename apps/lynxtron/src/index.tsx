import { render } from '@lynx-solid/runtime'
import { createSignal, onCleanup } from 'solid-js'

import { callMain, onMainEvent, readGlobalProps } from './desktop'
import './index.css'

interface Pong {
  pid: number
  platform: string
  node: string
  time: string
}

function App() {
  const props = readGlobalProps()
  const [count, setCount] = createSignal(0)
  const [pong, setPong] = createSignal<Pong>()
  const [clipboard, setClipboard] = createSignal('')
  const [pinging, setPinging] = createSignal(false)

  onCleanup(onMainEvent<Pong>('demo:pong', (payload) => {
    setPong(payload)
    setPinging(false)
  }))
  onCleanup(onMainEvent<string>('demo:clipboard', setClipboard))

  const ping = () => {
    setPinging(true)
    callMain('demo:ping', { sentAt: Date.now() })
  }

  const copy = () => {
    callMain('demo:copy', { text: `lynx-solid x lynxtron · count=${count()}` })
  }

  return (
    <view class="w-full h-full flex flex-col p-10 gap-[18px] bg-surface">
      <text class="text-[26px] font-semibold text-fg">Lynx Solid × Lynxtron</text>
      <text class="text-sm leading-[22px] text-muted">
        Solid 2 renders through the Lynx dual-thread runtime inside a native
        desktop window. The buttons below cross the bridge to the main process.
      </text>

      <view class="flex flex-col p-5 rounded-[14px] border border-line bg-panel gap-3">
        <text class="text-[11px] tracking-[1px] text-muted">SIGNAL</text>
        <view class="flex flex-row items-center gap-4">
          <view
            class="flex items-center justify-center px-[18px] py-[10px] rounded-[10px] bg-accent self-start"
            bindtap={() => setCount(n => n - 1)}
          >
            <text class="text-sm font-medium text-white">−</text>
          </view>
          <text class="text-[40px] font-semibold text-white min-w-[72px]">{count()}</text>
          <view
            class="flex items-center justify-center px-[18px] py-[10px] rounded-[10px] bg-accent self-start"
            bindtap={() => setCount(n => n + 1)}
          >
            <text class="text-sm font-medium text-white">+</text>
          </view>
        </view>
      </view>

      <view class="flex flex-col p-5 rounded-[14px] border border-line bg-panel gap-3">
        <text class="text-[11px] tracking-[1px] text-muted">MAIN PROCESS ROUND TRIP</text>
        <text class="text-sm leading-[21px] text-body">
          {pong()
            ? `pid ${pong()!.pid} · ${pong()!.platform} · node ${pong()!.node} · ${pong()!.time}`
            : pinging()
              ? 'waiting for the main process…'
              : 'nothing yet — the UI has never called the main process'}
        </text>
        <view
          class="flex items-center justify-center px-[18px] py-[10px] rounded-[10px] bg-accent self-start"
          bindtap={ping}
        >
          <text class="text-sm font-medium text-white">{pinging() ? 'pinging…' : 'Ping main process'}</text>
        </view>
      </view>

      <view class="flex flex-col p-5 rounded-[14px] border border-line bg-panel gap-3">
        <text class="text-[11px] tracking-[1px] text-muted">SYSTEM CLIPBOARD</text>
        <text class="text-sm leading-[21px] text-body">
          {clipboard()
            ? `read back from the clipboard: ${clipboard()}`
            : 'the main process writes, then reads back what the system actually holds'}
        </text>
        <view
          class="flex items-center justify-center px-[18px] py-[10px] rounded-[10px] bg-accent self-start"
          bindtap={copy}
        >
          <text class="text-sm font-medium text-white">Copy the counter value</text>
        </view>
      </view>

      <text class="text-xs text-dim mt-1">
        {`launched ${props.launchedAt ?? 'unknown'} · window ${props.window ?? 'main'}`}
      </text>
    </view>
  )
}

render(() => <App />)
