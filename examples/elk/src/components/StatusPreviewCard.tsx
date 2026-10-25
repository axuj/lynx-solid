import type { mastodon } from 'masto'
import { createMemo } from 'solid-js'

export function StatusPreviewCard(props: { card: mastodon.v1.PreviewCard }) {
  const vertical = createMemo(() =>
    !!props.card.image && (props.card.width ?? 0) >= (props.card.height ?? 1),
  )

  function hostOf(url: string): string {
    const m = url.match(/^https?:\/\/([^/]+)/)
    return m ? m[1].replace(/^www\./, '') : url
  }

  return (
    <view class={vertical() ? 'preview-card preview-card-vertical' : 'preview-card'}>
      {props.card.image && (
        <image
          src={props.card.image}
          class={vertical() ? 'preview-card-img preview-card-img-wide' : 'preview-card-img'}
          style={vertical()
            ? { aspectRatio: String(props.card.width && props.card.height ? props.card.width / props.card.height : 1.91) }
            : undefined}
          mode="aspectFill"
        />
      )}
      <view class="preview-card-body">
        <text class="preview-card-host">{hostOf(props.card.url)}</text>
        <text class="preview-card-title" text-maxline="2">{props.card.title}</text>
        {props.card.description && <text class="preview-card-desc" text-maxline="2">{props.card.description}</text>}
      </view>
    </view>
  )
}
