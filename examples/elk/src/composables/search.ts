import type { mastodon } from 'masto'
import { createEffect, createMemo, createSignal, isPending } from 'solid-js'
import { mastoClient } from './masto'
import { getAccountRoute, getStatusRoute, getTagRoute } from './routes'
import { currentUser } from './users'

export interface BuildSearchResult<K extends string, T> {
  id: string
  type: K
  data: T
  to: string
}
export type AccountSearchResult = BuildSearchResult<'account', mastodon.v1.Account>
export type HashTagSearchResult = BuildSearchResult<'hashtag', mastodon.v1.Tag>
export type StatusSearchResult = BuildSearchResult<'status', mastodon.v1.Status>

export function useSearch(query: () => string) {
  const q = createMemo(() => query().trim())
  const [debouncedQ, setDebouncedQ] = createSignal(q())

  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(
    () => q(),
    (v) => {
      if (timer)
        clearTimeout(timer)
      if (!v) {
        setDebouncedQ('')
        return
      }
      timer = setTimeout(() => setDebouncedQ(v), 300)
    },
  )

  const raw = createMemo(async () => {
    const v = debouncedQ()
    if (!v)
      return null
    return await mastoClient().v2.search.list({ q: v, resolve: !!currentUser() })
  })

  const loading = () => isPending(raw)

  const mapped = createMemo(() => {
    try {
      const v = raw()
      if (!v)
        return { accounts: [] as AccountSearchResult[], hashtags: [] as HashTagSearchResult[], statuses: [] as StatusSearchResult[] }
      return {
        accounts: v.accounts.map<AccountSearchResult>(account => ({
          type: 'account',
          id: account.id,
          data: account,
          to: getAccountRoute(account),
        })),
        hashtags: v.hashtags.map<HashTagSearchResult>(hashtag => ({
          type: 'hashtag',
          id: `hashtag-${hashtag.name}`,
          data: hashtag,
          to: getTagRoute(hashtag.name),
        })),
        statuses: v.statuses.map<StatusSearchResult>(status => ({
          type: 'status',
          id: status.id,
          data: status,
          to: getStatusRoute(status),
        })),
      }
    }
    catch {
      return { accounts: [] as AccountSearchResult[], hashtags: [] as HashTagSearchResult[], statuses: [] as StatusSearchResult[] }
    }
  })
  const accounts = () => mapped().accounts
  const hashtags = () => mapped().hashtags
  const statuses = () => mapped().statuses

  return { accounts, hashtags, statuses, loading }
}
