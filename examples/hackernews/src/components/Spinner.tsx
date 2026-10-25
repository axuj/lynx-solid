import { Show } from 'solid-js'

export function Spinner(props: { show: boolean }) {
  return (
    <Show when={props.show}>
      <view class="spinner" />
    </Show>
  )
}
