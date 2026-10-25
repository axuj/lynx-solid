import type { FeedItem } from '../api'
import { createMemo, Show } from 'solid-js'
import { push } from '../router'
import { isAbsoluteUrl, toHost } from '../utils'

interface NewsItemProps {
  item: FeedItem
}

export function NewsItem(props: NewsItemProps) {
  const itemUrl = createMemo(() => toHost(props.item.url))

  function goToItem() {
    push(`/item/${props.item.id}`)
  }

  function goToUser() {
    push(`/user/${props.item.user}`)
  }

  return (
    <view
      class="bg-hn-card flex flex-row border-b border-hn-border"
      style={{ padding: '20px 16px 20px 0' }}
    >
      {/* Score: 80px wide — center via parent flex (vue-lynx), no text-align/w-full */}
      <view
        class="flex items-center justify-center flex-shrink-0"
        style={{ width: '80px' }}
      >
        <text style={{ color: '#3eaf7c', fontSize: '1.1em', fontWeight: '700' }}>
          {props.item.points}
        </text>
      </view>

      {/* Content */}
      <view class="flex flex-col flex-1">
        {/* Title */}
        <text
          style={{ color: '#2e495e', fontSize: '15px', lineHeight: '20px' }}
          bindtap={goToItem}
        >
          {props.item.title}
        </text>

        {/* Host */}
        <Show when={isAbsoluteUrl(props.item.url)}>
          <text style={{ color: '#595959', fontSize: '0.85em', marginTop: '2px' }}>
            (
            {itemUrl()}
            )
          </text>
        </Show>

        {/* Meta line */}
        <view class="flex flex-row flex-wrap" style={{ marginTop: '4px', gap: '4px' }}>
          <Show when={props.item.type !== 'job'}>
            <text style={{ color: '#595959', fontSize: '0.85em' }}>
              by
              {' '}
            </text>
            <text
              style={{ color: '#595959', fontSize: '0.85em', textDecorationLine: 'underline' }}
              bindtap={goToUser}
            >
              {props.item.user}
            </text>
          </Show>
          <text style={{ color: '#595959', fontSize: '0.85em' }}>
            {props.item.time_ago}
          </text>
          <Show when={props.item.type !== 'job'}>
            <text style={{ color: '#595959', fontSize: '0.85em' }}>
              |
            </text>
            <text
              style={{ color: '#595959', fontSize: '0.85em', textDecorationLine: 'underline' }}
              bindtap={goToItem}
            >
              {props.item.comments_count}
              {' '}
              comments
            </text>
          </Show>
        </view>
      </view>
    </view>
  )
}
