import { For, Show } from 'solid-js'
import { fetchItem } from '../api'
import { Comment } from '../components/Comment'
import { Spinner } from '../components/Spinner'
import { useHnQuery } from '../composables/use-hn-query'
import { back, push } from '../router'
import { isAbsoluteUrl, toHost } from '../utils'

interface ItemPageProps {
  itemId: number
}

export function ItemPage(props: ItemPageProps) {
  const { data: item, isLoading, isError } = useHnQuery(
    () => `item#${props.itemId}`,
    key => fetchItem(Number(key.split('#')[1])),
  )

  const itemUrl = () => (item() ? toHost(item()?.url ?? '') : '')

  function goBack() {
    back()
  }

  function goToUser() {
    const it = item()
    if (it)
      push(`/user/${it.user}`)
  }

  return (
    <scroll-view class="flex-1" scroll-orientation="vertical">
      <Show when={isLoading()}>
        <view class="items-center" style={{ padding: '40px' }}>
          <Spinner show />
        </view>
      </Show>

      <Show when={!isLoading() && isError()}>
        <view class="items-center" style={{ padding: '40px' }}>
          <text style={{ fontSize: '15px', color: '#e53e3e' }}>
            Failed to load item.
          </text>
        </view>
      </Show>

      <Show when={item()}>
        {/* Item header card */}
        <view class="bg-hn-card flex flex-col" style={{ padding: '1.8em 2em 1em' }}>
          {/* Back link */}
          <text
            style={{ color: '#3eaf7c', fontSize: '13px', marginBottom: '12px' }}
            bindtap={goBack}
          >
            ‹ Back
          </text>

          {/* Title: 1.5em like reference h1 */}
          <text
            style={{ color: '#2e495e', fontSize: '1.5em', fontWeight: 'bold', lineHeight: '1.3em' }}
          >
            {item()?.title}
          </text>

          {/* Host */}
          <Show when={isAbsoluteUrl(item()?.url ?? '')}>
            <text
              style={{ color: '#595959', fontSize: '0.85em', marginTop: '4px' }}
            >
              {itemUrl()}
            </text>
          </Show>

          {/* Meta */}
          <view class="flex flex-row flex-wrap" style={{ marginTop: '8px', gap: '4px' }}>
            <text style={{ color: '#595959', fontSize: '0.85em' }}>
              {item()?.points}
              {' '}
              points | by
              {' '}
            </text>
            <text
              style={{ color: '#595959', fontSize: '0.85em', textDecorationLine: 'underline' }}
              bindtap={goToUser}
            >
              {item()?.user}
            </text>
            <text style={{ color: '#595959', fontSize: '0.85em' }}>
              {item()?.time_ago}
            </text>
          </view>
        </view>

        {/* Comments section */}
        <view class="bg-hn-card flex flex-col" style={{ marginTop: '10px', padding: '0 2em 0.5em' }}>
          {/* Comments header */}
          <view class="flex flex-row items-center" style={{ padding: '1em 0', gap: '8px' }}>
            <text style={{ fontSize: '1.1em', color: '#2e495e' }}>
              {item()?.comments.length
                ? `${item()?.comments.length} comments`
                : 'No comments yet'}
            </text>
          </view>

          <For each={item()?.comments ?? []}>
            {comment => <Comment comment={comment} depth={0} />}
          </For>
        </view>
      </Show>
    </scroll-view>
  )
}
