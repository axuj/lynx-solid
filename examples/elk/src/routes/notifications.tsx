import type { mastodon } from 'masto'
import { createFileRoute } from '@tanstack/solid-router'
import { createEffect, createSignal, For, Loading, Show } from 'solid-js'
import { AccountAvatar } from '../components/AccountAvatar'
import { AccountDisplayName } from '../components/AccountDisplayName'
import { AppIcon } from '../components/AppIcon'
import { ErrorRetryItem } from '../components/ErrorRetry'
import { PageHeader } from '../components/PageHeader'
import { Spinner } from '../components/Spinner'
import { StatusCard } from '../components/StatusCard'
import { mastoClient } from '../composables/masto'
import { useInfiniteCursor } from '../composables/paginator'
import { getAccountRoute } from '../composables/routes'
import { checkLogin } from '../composables/users'
import { push } from '../router'

function NotificationsPage() {
  const signedIn = () => checkLogin()

  const iconFor: Record<string, { icon: string, color: string, label: string }> = {
    follow: { icon: 'user-3-line', color: '#0ea5e9', label: 'followed you' },
    favourite: { icon: 'star-line', color: '#eab308', label: 'favourited your post' },
    reblog: { icon: 'repeat-fill', color: '#16a34a', label: 'boosted your post' },
    mention: { icon: 'at-line', color: '#cc7d24', label: 'mentioned you' },
    poll: { icon: 'bar-chart-fill', color: '#8b5cf6', label: 'poll ended' },
    update: { icon: 'quill-pen-line', color: '#686868', label: 'edited a post' },
  }

  const [filter, setFilter] = createSignal<'all' | 'mention'>('all')

  const [pages, loadNext, { reset }] = useInfiniteCursor<mastodon.v1.Notification>(
    async (cursor) => {
      if (!signedIn())
        return []
      const client = mastoClient()
      const paginator = client.v1.notifications.list({
        limit: 30,
        maxId: cursor,
        types: filter() === 'mention' ? ['mention'] : undefined,
      })
      const page = await paginator
      return page ?? []
    },
  )

  createEffect(
    () => filter(),
    () => {
      reset()
    },
  )

  return (
    <view class="page">
      <PageHeader title="Notifications" icon="notification-4-line" />

      <Show when={!signedIn()}>
        <view class="notif-empty">
          <AppIcon name="notification-4-line" size={40} color="#919191" />
          <text class="notif-empty-text">Sign in (Settings → token) to see your notifications.</text>
        </view>
      </Show>

      <Show when={signedIn()}>
        <view class="notif-filters">
          <view class={filter() === 'all' ? 'notif-filter notif-filter-active' : 'notif-filter'} bindtap={() => setFilter('all')}>
            <text class="notif-filter-text">All</text>
          </view>
          <view class={filter() === 'mention' ? 'notif-filter notif-filter-active' : 'notif-filter'} bindtap={() => setFilter('mention')}>
            <text class="notif-filter-text">Mentions</text>
          </view>
        </view>
      </Show>

      <Show when={signedIn()}>
        <list
          class="timeline-list"
          scroll-orientation="vertical"
          lower-threshold-item-count={4}
          bindscrolltolower={loadNext}
        >
          <For each={pages()}>
            {page => (
              <ErrorRetryItem label="NotificationsPage" onRetry={() => page.retry()}>
                <Loading fallback={<list-item item-key="loading" estimated-main-axis-size-px={60}><view class="notif-footer"><Spinner /></view></list-item>}>
                  <For each={page.content()}>
                    {n => (
                      <list-item item-key={n.id} estimated-main-axis-size-px={100}>
                        <view class="notif-card">
                          <view class="notif-head" bindtap={() => push(getAccountRoute(n.account))}>
                            <AppIcon
                              name={(iconFor[n.type] ?? iconFor.update).icon}
                              size={16}
                              color={(iconFor[n.type] ?? iconFor.update).color}
                            />
                            <AccountAvatar account={n.account} size={22} />
                            <AccountDisplayName account={n.account} fontSize={13} />
                            <text class="notif-label">{(iconFor[n.type] ?? iconFor.update).label}</text>
                          </view>
                          {n.status && <StatusCard status={n.status} showActions={n.type === 'mention'} />}
                        </view>
                      </list-item>
                    )}
                  </For>
                </Loading>
              </ErrorRetryItem>
            )}
          </For>
        </list>
      </Show>
    </view>
  )
}

export const Route = createFileRoute('/notifications')({
  component: NotificationsPage,
})
