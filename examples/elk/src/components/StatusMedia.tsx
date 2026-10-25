import type { mastodon } from 'masto'
import { createMemo, createSignal, For } from 'solid-js'
import { openMediaPreview } from '../composables/media-preview'

export function StatusMedia(props: {
  attachments: mastodon.v1.MediaAttachment[]
  sensitive?: boolean
}) {
  const [revealed, setRevealed] = createSignal(false)
  const hidden = createMemo(() => props.sensitive && !revealed())

  function onTapAttachment(att: mastodon.v1.MediaAttachment) {
    if (hidden()) {
      setRevealed(true)
      return
    }
    if (att.type === 'image' || att.type === 'gifv' || att.type === 'video')
      openMediaPreview(att.type === 'image' ? att : { ...att, url: att.previewUrl ?? att.url })
  }

  function typeBadge(att: mastodon.v1.MediaAttachment): string | null {
    if (att.type === 'video')
      return '▶ video'
    if (att.type === 'gifv')
      return 'GIF'
    if (att.type === 'audio')
      return '♪ audio'
    return null
  }

  function attachmentSrc(att: mastodon.v1.MediaAttachment): string {
    return att.previewUrl || att.url || ''
  }

  return (
    <>
      {props.attachments.length > 0 && (
        <view class={props.attachments.length > 1 ? 'status-media status-media-grid' : 'status-media'}>
          <For each={props.attachments}>
            {att => (
              attachmentSrc(att)
                ? (
                    <view
                      class={props.attachments.length > 1 ? 'status-media-item status-media-item-half' : 'status-media-item'}
                      bindtap={() => onTapAttachment(att)}
                    >
                      <image
                        src={attachmentSrc(att)}
                        class="status-media-img"
                        style={{ aspectRatio: String((props.attachments.length > 1 ? 1 : att.meta?.original?.aspect) || 1.618), filter: hidden() ? 'blur(30px)' : 'none' }}
                        mode="aspectFill"
                      />
                      {hidden()
                        ? (
                            <view class="status-media-sensitive">
                              <text class="status-media-sensitive-text">Sensitive content</text>
                              <text class="status-media-sensitive-sub">Tap to reveal</text>
                            </view>
                          )
                        : typeBadge(att)
                          ? (
                              <view class="status-media-badge">
                                <text class="status-media-badge-text">{typeBadge(att)}</text>
                              </view>
                            )
                          : null}
                    </view>
                  )
                : null
            )}
          </For>
        </view>
      )}
    </>
  )
}
