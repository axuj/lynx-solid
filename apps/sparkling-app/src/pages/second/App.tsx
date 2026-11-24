import { createSignal, onSettled } from 'solid-js'
import { close } from 'sparkling-navigation'

import '../../App.css'

export function App() {
  const [note, setNote] = createSignal('no taps yet')

  onSettled(() => {
    console.info('[sparkling-solid] second page mounted')
  })

  return (
    <scroll-view class="h-screen w-full" scroll-orientation="vertical">
      <view class="app-bg min-h-screen flex flex-col gap-[18px] px-5 pt-6 pb-10">
        <view class="flex flex-col items-center gap-2.5 text-center pt-[18px]">
          <text class="px-3.5 py-1.5 rounded-full bg-accent-soft text-accent-muted text-xs font-bold tracking-[0.6px]">
            SECOND CONTAINER
          </text>
          <text class="mt-1.5 text-slate-50 text-[26px] font-extrabold">
            This page has its own bundle
          </text>
          <text class="text-slate-400 text-sm leading-5 max-w-[300px] text-center">
            main.lynx.bundle opened second.lynx.bundle through the native router — no WebView involved.
          </text>
        </view>

        <view class="bg-panel border border-panel-border rounded-2xl p-4 flex flex-col gap-3">
          <view class="flex flex-row items-center justify-between">
            <text class="text-slate-200 text-[15px] font-bold">Still Solid</text>
            <text class="text-accent text-[11px] font-bold tracking-[0.4px]">SIGNAL</text>
          </view>
          <text class="text-slate-300 text-xs">{`state: ${note()}`}</text>
          <view
            class="flex flex-row items-center justify-center gap-2 px-[18px] py-3 rounded-xl bg-accent"
            bindtap={() => setNote(`tapped ${Date.now()}`)}
          >
            <text class="text-ink text-[15px] font-bold">Touch me</text>
          </view>
        </view>

        <view
          class="flex items-center justify-center px-[18px] py-3 rounded-xl border border-panel-strong"
          bindtap={() => close()}
        >
          <text class="text-slate-200 text-[15px] font-semibold">Close this page</text>
        </view>

        <text class="text-slate-500 text-[11px] text-center leading-4 px-3">
          close() goes straight to the Sparkling native router.
        </text>
      </view>
    </scroll-view>
  )
}
