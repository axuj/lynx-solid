import type { mastodon } from 'masto'
import { createEffect, createSignal, For, latest, Loading } from 'solid-js'
import { mastoClient } from '../composables/masto'
import { useInfiniteCursor } from '../composables/paginator'
import { filterAndReorderTimeline } from '../composables/timeline'
import { AppIcon } from './AppIcon'
import { ErrorRetryItem } from './ErrorRetry'
import { PageHeader } from './PageHeader'
import { Spinner } from './Spinner'
import { StatusCard } from './StatusCard'

const titles = {
  home: { title: 'Home', icon: 'home-5-line' },
  public: { title: 'Federated Timeline', icon: 'earth-line' },
  local: { title: 'Local Timeline', icon: 'group-2-line' },
} as const

export function TimelinePage(props: { kind?: 'home' | 'public' | 'local' }) {
  const kind = () => props.kind ?? 'public'
  const selecterKind = () => latest(kind)
  const [refreshing, setRefreshing] = createSignal(false)

  const [pages, loadNext, { reset }] = useInfiniteCursor<mastodon.v1.Status>(
    async (cursor) => {
      const k = kind()
      const client = mastoClient()
      const paginator = k === 'home'
        ? client.v1.timelines.home.list({ limit: 30, maxId: cursor })
        : client.v1.timelines.public.list({ limit: 30, maxId: cursor, local: k === 'local' ? true : undefined })
      const page = await paginator
      return filterAndReorderTimeline([...(page ?? [])], k === 'home' ? 'home' : 'public')
    },
  )

  createEffect(
    () => kind(),
    () => {
      reset()
    },
  )

  function refresh() {
    if (refreshing())
      return
    setRefreshing(true)
    reset()
    setTimeout(() => setRefreshing(false), 450)
  }

  return (
    <view class="page">
      <PageHeader title={titles[selecterKind()].title} icon={titles[selecterKind()].icon}>
        <view class={refreshing() ? 'timeline-refresh timeline-refreshing' : 'timeline-refresh'} bindtap={refresh}>
          <AppIcon name="refresh-line" size={20} color="#686868" />
        </view>
      </PageHeader>

      <list
        class="timeline-list"
        scroll-orientation="vertical"
        lower-threshold-item-count={4}
        bindscrolltolower={loadNext}
      >
        <For each={pages()}>
          {page => (
            <ErrorRetryItem label="TimelinePage" onRetry={() => page.retry()}>
              <Loading
                fallback={(
                  <list-item item-key="loading" estimated-main-axis-size-px={60}>
                    <view class="timeline-loading">
                      <Spinner />
                    </view>
                  </list-item>
                )}
              >
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
    </view>
  )
}
