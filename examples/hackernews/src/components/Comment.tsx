import type { CommentData } from '../api'
import { createSignal, For, Show } from 'solid-js'
import { push } from '../router'
import { pluralize, stripHtml } from '../utils'

interface CommentProps {
  comment: CommentData
  depth?: number
}

export function Comment(props: CommentProps) {
  const [open, setOpen] = createSignal(true)

  function goToUser(userId: string) {
    push(`/user/${userId}`)
  }

  return (
    <Show when={props.comment && props.comment.user}>
      <view
        class="flex flex-col border-t border-hn-border"
        style={{ paddingLeft: `${(props.depth ?? 0) * 24}px` }}
      >
        {/* Comment header */}
        <view class="flex flex-row" style={{ gap: '6px', paddingTop: '1em' }}>
          <text
            style={{ color: '#222', fontSize: '0.9em', textDecorationLine: 'underline' }}
            bindtap={() => goToUser(props.comment.user)}
          >
            {props.comment.user}
          </text>
          <text style={{ color: '#595959', fontSize: '0.9em' }}>
            {props.comment.time_ago}
          </text>
        </view>

        {/* Comment body */}
        <view style={{ paddingTop: '0.5em', paddingBottom: '0.5em' }}>
          <text style={{ color: '#2e495e', fontSize: '0.9em', lineHeight: '1.5em' }}>
            {stripHtml(props.comment.content)}
          </text>
        </view>

        {/* Toggle children */}
        <Show when={props.comment.comments && props.comment.comments.length}>
          <view
            style={{
              backgroundColor: open() ? 'transparent' : '#fffbf2',
              borderRadius: '4px',
              padding: open() ? '0' : '0.3em 0.5em',
              alignSelf: 'flex-start',
              marginBottom: open() ? '0' : '0.5em',
            }}
            bindtap={() => setOpen(prev => !prev)}
          >
            <text style={{ color: '#222', fontSize: '0.9em' }}>
              {open()
                ? '[-]'
                : `[+] ${pluralize(props.comment.comments.length, 'reply', 'replies')} collapsed`}
            </text>
          </view>
        </Show>

        {/* Nested comments */}
        <Show when={open() && props.comment.comments && props.comment.comments.length}>
          <For each={props.comment.comments}>
            {childComment => (
              <Comment comment={childComment} depth={(props.depth ?? 0) + 1} />
            )}
          </For>
        </Show>
      </view>
    </Show>
  )
}
