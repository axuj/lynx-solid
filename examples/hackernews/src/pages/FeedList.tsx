import type { FeedItem } from '../api'
import { createEffect, createMemo, For, Show } from 'solid-js'
import { fetchFeed, validFeeds } from '../api'
import { NewsItem } from '../components/NewsItem'
import { Spinner } from '../components/Spinner'
import { prefetchHnQuery, useHnQuery } from '../composables/use-hn-query'
import { push } from '../router'

interface FeedListProps {
  feed: string
  page: number
}

function fetchFeedPage(key: string): Promise<FeedItem[]> {
  const [feed, pageStr] = key.split('#')
  return fetchFeed(feed, Number.parseInt(pageStr, 10))
}

export function FeedList(props: FeedListProps) {
  const feedKey = () => `${props.feed}#${props.page}`
  const { data: items, isLoading, isFetching, isError } = useHnQuery(feedKey, fetchFeedPage)

  const maxPage = createMemo(() => validFeeds[props.feed]?.pages ?? 1)
  const hasPrev = () => props.page > 1
  const hasNext = () => props.page < maxPage()

  createEffect(
    () => [props.feed, props.page] as const,
    ([feed, page]) => {
      prefetchHnQuery(`${feed}#${page}`, fetchFeedPage)
      if (page < maxPage())
        prefetchHnQuery(`${feed}#${page + 1}`, fetchFeedPage)
      if (page > 1)
        prefetchHnQuery(`${feed}#${page - 1}`, fetchFeedPage)
    },
  )

  function goPrev() {
    if (hasPrev())
      push(`/${props.feed}/${props.page - 1}`)
  }

  function goNext() {
    if (hasNext())
      push(`/${props.feed}/${props.page + 1}`)
  }

  return (
    <view class="flex flex-col flex-1">
      {/* Pagination nav */}
      <view
        class="bg-hn-card flex flex-row items-center justify-center border-b border-hn-border"
        style={{ padding: '15px 30px', gap: '1em' }}
      >
        <text
          style={{ fontSize: '15px', color: hasPrev() ? '#3eaf7c' : '#595959', opacity: hasPrev() ? 1 : 0.5 }}
          bindtap={goPrev}
        >
          ‹ prev
        </text>
        <text style={{ fontSize: '15px', color: '#2e495e' }}>
          {props.page}
          /
          {maxPage()}
        </text>
        <text
          style={{ fontSize: '15px', color: hasNext() ? '#3eaf7c' : '#595959', opacity: hasNext() ? 1 : 0.5 }}
          bindtap={goNext}
        >
          {'more >'}
        </text>
      </view>

      {/* Item list */}
      <scroll-view class="flex-1" scroll-orientation="vertical">
        {/* Full loading (no cached data) */}
        <Show when={isLoading()}>
          <view class="items-center" style={{ padding: '40px' }}>
            <Spinner show />
          </view>
        </Show>

        <Show when={!isLoading() && isError()}>
          <view class="items-center" style={{ padding: '40px' }}>
            <text style={{ fontSize: '15px', color: '#e53e3e' }}>Failed to load stories.</text>
          </view>
        </Show>

        <Show when={!isLoading() && !isError()}>
          {/* Background refetch indicator */}
          <Show when={isFetching()}>
            <view class="items-center" style={{ paddingTop: '12px' }}>
              <Spinner show />
            </view>
          </Show>

          <view class="bg-hn-card" style={{ marginTop: '10px' }}>
            <For each={items()}>
              {item => <NewsItem item={item} />}
            </For>
          </view>
        </Show>
      </scroll-view>
    </view>
  )
}
