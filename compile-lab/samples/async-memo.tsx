import { render } from '@lynx-solid/runtime'
import { createMemo, createSignal, For, Loading, Show } from 'solid-js'

const USERS = ['alice', 'bob', 'carol', 'dave', 'erin']

function fetchUsers(delay = 1200): Promise<string[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve([...USERS]), delay)
  })
}

function App() {
  const [count, setCount] = createSignal(0)
  const [reloadKey, setReloadKey] = createSignal(0)

  // Async memo: re-requests whenever count/reloadKey change.
  const users = createMemo(async () => {
    void count()
    void reloadKey()
    return fetchUsers()
  })

  return (
    <view style="width:100%;height:100%;background:#fff">
      <view style="padding:16px;border-bottom:1px solid #ddd">
        <text style="font-size:18px;font-weight:bold">users (async memo)</text>
      </view>

      <Loading fallback={<text>loading…</text>} on={users()}>
        <view style="padding:16px">
          <For each={users()}>
            {name => (
              <view
                style="height:44px;justify-content:center;border-bottom:1px solid #eee"
              >
                <text>{name}</text>
              </view>
            )}
          </For>
        </view>
      </Loading>

      <Show when={count() > 0}>
        <text style="padding-left:16px">
          reloaded
          {count()}
          {' '}
          time(s)
        </text>
      </Show>

      <view
        bindtap={() => {
          setCount(c => c + 1)
          setReloadKey(k => k + 1)
        }}
        style="margin:16px;height:44px;background:lightgreen;justify-content:center;align-items:center"
      >
        <text>reload</text>
      </view>
    </view>
  )
}

render(() => <App />)
