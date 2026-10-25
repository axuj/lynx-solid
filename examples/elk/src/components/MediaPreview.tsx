import { createMemo, Show } from 'solid-js'
import { closeMediaPreview, mediaPreview } from '../composables/media-preview'
import { AppIcon } from './AppIcon'

export function MediaPreview() {
  const preview = createMemo(() => mediaPreview())

  function close() {
    closeMediaPreview()
  }

  return (
    <Show when={preview()} fallback={null}>
      {p => (
        <view class="media-preview" bindtap={close}>
          <image src={p().url ?? ''} class="media-preview-img" mode="aspectFit" />
          <view class="media-preview-close" bindtap={close}>
            <AppIcon name="close-line" size={22} color="#ffffff" />
          </view>
          {p().description && (
            <view class="media-preview-alt">
              <text class="media-preview-alt-text" text-maxline="4">{p().description}</text>
            </view>
          )}
        </view>
      )}
    </Show>
  )
}
