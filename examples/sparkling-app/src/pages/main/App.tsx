import { createSignal, onSettled } from 'solid-js'
import { navigate } from 'sparkling-navigation'

import '../../App.css'
import logo from '../../assets/sparkling_icon.png'

export function App() {
  const [count, setCount] = createSignal(0)
  const [lastResult, setLastResult] = createSignal('—')

  onSettled(() => {
    console.info('[sparkling-solid] main page mounted')
  })

  const openSecond = () => {
    navigate(
      {
        path: 'second.lynx.bundle',
        options: { params: { title: 'Second', hide_nav_bar: 1 } },
      },
      (res) => {
        setLastResult(`${res.code}`)
      },
    )
  }

  return (
    <scroll-view class="h-screen w-full" scroll-orientation="vertical">
      <view class="app-bg min-h-screen flex flex-col gap-[18px] px-5 pt-6 pb-10">
        <view class="flex flex-col items-center gap-2.5 text-center pt-[18px]">
          <image class="w-[92px] h-[92px] rounded-3xl" src={logo} />
          <text class="px-3.5 py-1.5 rounded-full bg-accent-soft text-accent-muted text-xs font-bold tracking-[0.6px]">
            SOLID · LYNX · SPARKLING
          </text>
          <text class="mt-1.5 text-slate-50 text-[26px] font-extrabold">
            A real app, not a demo page
          </text>
          <text class="text-slate-400 text-sm leading-5 max-w-[300px] text-center">
            Solid signals drive a native Lynx view tree, shipped as an APK by Sparkling.
          </text>
        </view>

        <view class="bg-panel border border-panel-border rounded-2xl p-4 flex flex-col gap-3">
          <view class="flex flex-row items-center justify-between">
            <text class="text-slate-200 text-[15px] font-bold">Reactivity</text>
            <text class="text-accent text-[11px] font-bold tracking-[0.4px]">SIGNAL</text>
          </view>
          <view class="flex flex-row items-center justify-between">
            <text class="text-slate-400 text-[13px]">count</text>
            <text class="text-slate-50 text-[34px] font-extrabold">{count()}</text>
          </view>
          <view
            class="flex flex-row items-center justify-center gap-2 px-[18px] py-3 rounded-xl bg-accent"
            bindtap={() => setCount(count() + 1)}
          >
            <text class="text-ink text-[15px] font-bold">Increment</text>
          </view>
        </view>

        <view class="bg-panel border border-panel-border rounded-2xl p-4 flex flex-col gap-3">
          <view class="flex flex-row items-center justify-between">
            <text class="text-slate-200 text-[15px] font-bold">Native navigation</text>
            <text class="text-accent text-[11px] font-bold tracking-[0.4px]">
              SPARKLING METHOD
            </text>
          </view>
          <text class="text-slate-400 text-[13px]">
            Second page runs in its own container.
          </text>
          <view
            class="flex flex-row items-center justify-center gap-2 px-[18px] py-3 rounded-xl bg-accent"
            bindtap={openSecond}
          >
            <text class="text-ink text-[15px] font-bold">Open second page</text>
          </view>
          <text class="text-slate-300 text-xs">{`last result: ${lastResult()}`}</text>
        </view>

        <text class="text-slate-500 text-[11px] text-center leading-4 px-3">
          Edit src/pages/main/App.tsx — the dev server hot-reloads both the web preview and LynxExplorer.
        </text>
      </view>
    </scroll-view>
  )
}
