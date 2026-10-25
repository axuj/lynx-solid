import type { mastodon } from 'masto'
import { createEffect, createSignal, For, Loading } from 'solid-js'
import { fetchAccountByHandle } from '../composables/cache'
import { mastoClient } from '../composables/masto'
import { useInfiniteCursor } from '../composables/paginator'
import { getAccountRoute } from '../composables/routes'
import { push } from '../router'
import { AccountAvatar } from './AccountAvatar'
import { AccountDisplayName } from './AccountDisplayName'
import { ErrorRetryItem } from './ErrorRetry'
import { PageHeader } from './PageHeader'
import { Spinner } from './Spinner'

export function FollowList(props: { kind: 'followers' | 'following', account: string }) {
  const kind = () => props.kind
  const title = () => (kind() === 'following' ? 'Following' : 'Followers')
  const handle = () => props.account.replace(/^@/, '')

  const [accountId, setAccountId] = createSignal<string | null>(null)

  createEffect(
    () => handle(),
    (h) => {
      if (!h) {
        setAccountId(null)
        return
      }
      void fetchAccountByHandle(h)
        .then(acc => setAccountId(acc.id))
        .catch(() => setAccountId(null))
    },
  )

  const [pages, loadNext, { reset }] = useInfiniteCursor<mastodon.v1.Account>(
    async (cursor) => {
      const id = accountId()
      if (!id)
        return []
      const client = mastoClient()
      const api = client.v1.accounts.$select(id)
      const paginator = kind() === 'following'
        ? api.following.list({ limit: 40, maxId: cursor })
        : api.followers.list({ limit: 40, maxId: cursor })
      const page = await paginator
      return page ?? []
    },
  )

  createEffect(
    () => ({ h: handle(), k: kind() }),
    () => {
      reset()
    },
  )

  return (
    <view class="page">
      <PageHeader title={title()} back />
      <list
        class="timeline-list"
        scroll-orientation="vertical"
        lower-threshold-item-count={6}
        bindscrolltolower={loadNext}
      >
        <For each={pages()}>
          {page => (
            <ErrorRetryItem label="FollowListPage" onRetry={() => page.retry()}>
              <Loading fallback={<list-item item-key="loading" estimated-main-axis-size-px={50}><view class="follow-footer"><Spinner /></view></list-item>}>
                <For each={page.content()}>
                  {account => (
                    <list-item item-key={account.id} estimated-main-axis-size-px={64}>
                      <view class="follow-row" bindtap={() => push(getAccountRoute(account))}>
                        <AccountAvatar account={account} size={44} />
                        <view class="follow-names">
                          <AccountDisplayName account={account} fontSize={14} />
                          <text class="follow-handle" text-maxline="1">
                            @
                            {account.acct}
                          </text>
                        </view>
                      </view>
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
