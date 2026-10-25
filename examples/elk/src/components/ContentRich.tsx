import type { mastodon } from 'masto'
import { contentToJSX } from '../content/content-render'
import { push } from '../router'

export interface ContentRichProps {
  content: string
  emojis?: mastodon.v1.CustomEmoji[]
  mentions?: mastodon.v1.StatusMention[]
  markdown?: boolean
  collapseMentionLink?: boolean
  status?: mastodon.v1.Status
  inReplyToStatus?: mastodon.v1.Status
}

export function ContentRich(props: ContentRichProps) {
  return (
    <view class="content-rich">
      {contentToJSX(props.content, {
        emojis: Object.fromEntries((props.emojis ?? []).map(e => [e.shortcode, e])),
        mentions: props.mentions,
        markdown: props.markdown ?? true,
        collapseMentionLink: props.collapseMentionLink ?? false,
        status: props.status,
        inReplyToStatus: props.inReplyToStatus,
      }, {})}
    </view>
  )
}

export { push }
