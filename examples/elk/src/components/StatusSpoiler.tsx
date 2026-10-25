import { createSignal } from 'solid-js'

export function StatusSpoiler(props: { spoilerText: string, children?: JSX.Element }) {
  const [expanded, setExpanded] = createSignal(false)

  return (
    <>
      <view class="status-spoiler">
        <text class="status-spoiler-text">{props.spoilerText}</text>
        <view class="status-spoiler-btn" bindtap={() => setExpanded(!expanded())}>
          <text class="status-spoiler-btn-text">{expanded() ? 'Hide content' : 'Show content'}</text>
        </view>
      </view>
      {expanded() ? props.children : null}
    </>
  )
}
