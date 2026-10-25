import type { mastodon } from 'masto'
import { createEffect, createMemo, For, Loading } from 'solid-js'
import { mastoClient } from '../composables/masto'
import { useInfiniteCursor } from '../composables/paginator'
import { checkLogin } from '../composables/users'
import { AppIcon } from './AppIcon'
import { ErrorRetryItem } from './ErrorRetry'
import { PageHeader } from './PageHeader'
import { Spinner } from './Spinner'
import { StatusCard } from './StatusCard'

export function CollectionPage(props: { kind?: 'bookmarks' | 'favourites' }) {
  const meta = {
    bookmarks: { title: 'Bookmarks', icon: 'bookmark-line' },
    favourites: { title: 'Favourites', icon: 'heart-3-line' },
  } as const

  const kind = createMemo(() => props.kind ?? 'bookmarks')
  const signedIn = checkLogin()

  const [pages, loadNext, { reset }] = useInfiniteCursor<mastodon.v1.Status>(
    async (cursor) => {
      const k = kind()
      const client = mastoClient()
      const paginator = k === 'bookmarks'
        ? client.v1.bookmarks.list({ limit: 30, maxId: cursor })
        : client.v1.favourites.list({ limit: 30, maxId: cursor })
      const page = await paginator
      return page ?? []
    },
  )

  createEffect(
    () => kind(),
    () => {
      reset()
    },
  )

  return (
    <view class="page">
      <PageHeader title={meta[kind()].title} icon={meta[kind()].icon} back />
      {!signedIn
        ? (
            <view class="collection-empty">
              <AppIcon name={meta[kind()].icon} size={40} color="#919191" />
              <text class="collection-empty-text">
                Sign in (Settings → token) to see your
                {' '}
                {meta[kind()].title.toLowerCase()}
                .
              </text>
            </view>
          )
        : (
            <list
              class="timeline-list"
              scroll-orientation="vertical"
              lower-threshold-item-count={4}
              bindscrolltolower={loadNext}
            >
              <For each={pages()}>
                {page => (
                  <ErrorRetryItem label="CollectionPage" onRetry={() => page.retry()}>
                    <Loading fallback={<list-item item-key="loading" estimated-main-axis-size-px={60}><view class="timeline-loading"><Spinner /></view></list-item>}>
                      <For each={page.content()}>
                        {status => (
                          <list-item item-key={status.id} estimated-main-axis-size-px={160}>
                            <StatusCard status={status} />
                          </list-item>
                        )}
                      </For>
                    </Loading>
                  </ErrorRetryItem>
                )}
              </For>
            </list>
          )}
    </view>
  )
}
