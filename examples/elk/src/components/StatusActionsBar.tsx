import type { mastodon } from 'masto'
import { createSignal } from 'solid-js'
import { formatCompactNumber } from '../composables/format'
import { useStatusActions } from '../composables/status-actions'
import { push } from '../router'
import { AppIcon } from './AppIcon'

export function StatusActionsBar(props: { status: mastodon.v1.Status }) {
  const [pressedAction, setPressedAction] = createSignal<string | null>(null)

  const { status, toggleReblog, toggleFavourite, toggleBookmark } = useStatusActions(() => props.status)

  function reply() {
    push(`/compose?replyTo=${status().id}`)
  }

  function press(action: string) {
    setPressedAction(action)
  }

  function release() {
    setPressedAction(null)
  }

  return (
    <view class="status-actions">
      <view
        class={pressedAction() === 'reply' ? 'status-action status-action-reply status-action-pressed' : 'status-action status-action-reply'}
        bindtouchstart={() => press('reply')}
        bindtouchend={release}
        bindtouchcancel={release}
        bindtap={reply}
      >
        <view class="status-action-icon status-action-icon-reply">
          <AppIcon name="chat-1-line" size={20} color="#686868" />
        </view>
        {status().repliesCount ? <text class="status-action-count">{formatCompactNumber(status().repliesCount)}</text> : null}
      </view>
      <view
        class={pressedAction() === 'reblog' ? 'status-action status-action-reblog status-action-pressed' : 'status-action status-action-reblog'}
        bindtouchstart={() => press('reblog')}
        bindtouchend={release}
        bindtouchcancel={release}
        bindtap={toggleReblog}
      >
        <view class="status-action-icon status-action-icon-reblog">
          <AppIcon name="repeat-fill" size={20} color={status().reblogged ? '#16a34a' : '#686868'} />
        </view>
        {status().reblogsCount
          ? (
              <text class="status-action-count" style={status().reblogged ? { color: '#16a34a' } : undefined}>
                {formatCompactNumber(status().reblogsCount)}
              </text>
            )
          : null}
      </view>
      <view
        class={pressedAction() === 'favourite' ? 'status-action status-action-favourite status-action-pressed' : 'status-action status-action-favourite'}
        bindtouchstart={() => press('favourite')}
        bindtouchend={release}
        bindtouchcancel={release}
        bindtap={toggleFavourite}
      >
        <view class="status-action-icon status-action-icon-favourite">
          <AppIcon name={status().favourited ? 'heart-3-fill' : 'heart-3-line'} size={20} color={status().favourited ? '#f43f5e' : '#686868'} />
        </view>
        {status().favouritesCount
          ? (
              <text class="status-action-count" style={status().favourited ? { color: '#f43f5e' } : undefined}>
                {formatCompactNumber(status().favouritesCount)}
              </text>
            )
          : null}
      </view>
      <view
        class={pressedAction() === 'bookmark' ? 'status-action status-action-bookmark status-action-pressed' : 'status-action status-action-bookmark'}
        bindtouchstart={() => press('bookmark')}
        bindtouchend={release}
        bindtouchcancel={release}
        bindtap={toggleBookmark}
      >
        <view class="status-action-icon status-action-icon-bookmark">
          <AppIcon name={status().bookmarked ? 'bookmark-fill' : 'bookmark-line'} size={20} color={status().bookmarked ? '#cc7d24' : '#686868'} />
        </view>
      </view>
    </view>
  )
}
