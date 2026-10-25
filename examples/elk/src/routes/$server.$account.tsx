import type { mastodon } from 'masto'
import { createFileRoute } from '@tanstack/solid-router'
import { createEffect, createMemo, createSignal, For, Loading } from 'solid-js'
import { AccountAvatar } from '../components/AccountAvatar'
import { AccountDisplayName } from '../components/AccountDisplayName'
import { ContentRich } from '../components/ContentRich'
import { ErrorRetry, ErrorRetryItem } from '../components/ErrorRetry'
import { PageHeader } from '../components/PageHeader'
import { Spinner } from '../components/Spinner'
import { StatusCard } from '../components/StatusCard'
import { fetchAccountByHandle } from '../composables/cache'
import { formatCompactNumber } from '../composables/format'
import { mastoClient } from '../composables/masto'
import { useInfiniteCursor } from '../composables/paginator'
import { currentPath, push } from '../router'

export const Route = createFileRoute('/$server/$account')({
  component: AccountPage,
})

function AccountPage() {
  const params = Route.useParams()
  const [tab, setTab] = createSignal<'posts' | 'replies' | 'media'>('posts')
  const handle = createMemo(() => params().account.replace(/^@/, ''))

  const tabs = [
    { key: 'posts', label: 'Posts' },
    { key: 'replies', label: 'Posts & Replies' },
    { key: 'media', label: 'Media' },
  ] as const

  const account = createMemo(async () => {
    const h = handle()
    if (!h)
      return null
    return fetchAccountByHandle(h)
  })

  const [pages, loadNext, { reset }] = useInfiniteCursor<mastodon.v1.Status>(
    async (cursor) => {
      const k = tab()
      const acc = account()
      if (!acc)
        return []
      const client = mastoClient()
      const paginator = client.v1.accounts.$select(acc.id).statuses.list({
        limit: 30,
        maxId: cursor,
        excludeReplies: k === 'posts',
        onlyMedia: k === 'media',
      })
      const page = await paginator
      return page ?? []
    },
  )

  createEffect(
    () => ({ t: tab(), h: handle() }),
    () => {
      reset()
    },
  )

  return (
    <view class="page">
      <PageHeader title="Profile" back />
      <Loading fallback={<view class="account-loading"><Spinner /></view>}>
        <ErrorRetry label="AccountPage-profile">
          <AccountBody account={account} pages={pages} loadNext={loadNext} tabs={tabs} tab={tab} setTab={setTab} />
        </ErrorRetry>
      </Loading>
    </view>
  )
}

function AccountBody(props: {
  account: import('solid-js').Accessor<mastodon.v1.Account | null>
  pages: import('solid-js').Accessor<import('../composables/paginator').InfiniteScrollPage<mastodon.v1.Status>[]>
  loadNext: () => void
  tabs: readonly { key: 'posts' | 'replies' | 'media', label: string }[]
  tab: import('solid-js').Accessor<'posts' | 'replies' | 'media'>
  setTab: (k: 'posts' | 'replies' | 'media') => void
}) {
  const acc = () => props.account()!
  const joined = () => {
    try {
      const d = new Date(acc().createdAt)
      return `Joined ${d.toLocaleDateString?.('en-US', { month: 'long', year: 'numeric' }) ?? d.getFullYear()}`
    }
    catch {
      return ''
    }
  }

  return (
    <>
      <view class="account-profile">
        <image src={acc().header} class="account-banner" mode="aspectFill" />

        <view class="account-head">
          <view class="account-avatar-row">
            <view class="account-avatar-ring">
              <AccountAvatar account={acc()} size={72} />
            </view>
          </view>

          <AccountDisplayName account={acc()} fontSize={20} />
          <text class="account-handle">
            @
            {acc().acct}
          </text>

          {acc().note && (
            <view class="account-note">
              <ContentRich content={acc().note} emojis={acc().emojis} />
            </view>
          )}

          {acc().fields?.length
            ? (
                <view class="account-fields">
                  <For each={acc().fields!}>
                    {field => (
                      <view
                        class={field.verifiedAt ? 'account-field account-field-verified' : 'account-field'}
                      >
                        <text class="account-field-name">{field.name}</text>
                        <view class="account-field-value">
                          <ContentRich content={field.value} emojis={acc().emojis} markdown />
                        </view>
                      </view>
                    )}
                  </For>
                </view>
              )
            : null}

          <text class="account-joined">{joined()}</text>

          <view class="account-stats">
            <view class="account-stat">
              <text class="account-stat-num">{formatCompactNumber(acc().statusesCount)}</text>
              <text class="account-stat-label">Posts</text>
            </view>
            <view class="account-stat" bindtap={() => push(`${currentPath().replace(/\/$/, '')}/following`)}>
              <text class="account-stat-num">{formatCompactNumber(acc().followingCount)}</text>
              <text class="account-stat-label">Following</text>
            </view>
            <view class="account-stat" bindtap={() => push(`${currentPath().replace(/\/$/, '')}/followers`)}>
              <text class="account-stat-num">{formatCompactNumber(acc().followersCount)}</text>
              <text class="account-stat-label">Followers</text>
            </view>
          </view>
        </view>

        <view class="account-tabs">
          <For each={props.tabs}>
            {t => (
              <view class="account-tab" bindtap={() => props.setTab(t.key)}>
                <text class={props.tab() === t.key ? 'account-tab-text account-tab-active' : 'account-tab-text'}>
                  {t.label}
                </text>
                <view
                  class={props.tab() === t.key ? 'account-tab-underline account-tab-underline-active' : 'account-tab-underline'}
                />
              </view>
            )}
          </For>
        </view>
      </view>

      <list
        class="timeline-list"
        scroll-orientation="vertical"
        lower-threshold-item-count={4}
        bindscrolltolower={props.loadNext}
      >
        <For each={props.pages()}>
          {page => (
            <ErrorRetryItem label="AccountPage" onRetry={() => page.retry()}>
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
    </>
  )
}
