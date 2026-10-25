import type { mastodon } from 'masto'
import { createEffect, createMemo, createSignal } from 'solid-js'
import { cacheStatus } from './cache'
import { mastoClient } from './masto'
import { checkLogin, currentUser } from './users'

type Action = 'reblogged' | 'favourited' | 'bookmarked' | 'pinned' | 'muted'
type CountField = 'reblogsCount' | 'favouritesCount'

export function useStatusActions(getStatus: () => mastodon.v1.Status): {
  status: () => mastodon.v1.Status
  isLoading: () => { reblogged: boolean, favourited: boolean, bookmarked: boolean, pinned: boolean, muted: boolean }
  canReblog: () => boolean
  toggleReblog: () => void
  toggleFavourite: () => void
  toggleBookmark: () => void
} {
  const [status, setStatus] = createSignal<mastodon.v1.Status>({ ...getStatus() })
  // Sync when the parent status changes, avoid stale (e.g. timeline refresh)
  createEffect(
    () => getStatus(),
    (fresh) => {
      setStatus({ ...fresh })
    },
  )

  const [isLoading, setIsLoading] = createSignal({
    reblogged: false,
    favourited: false,
    bookmarked: false,
    pinned: false,
    muted: false,
  } as { reblogged: boolean, favourited: boolean, bookmarked: boolean, pinned: boolean, muted: boolean })

  async function toggleStatusAction(
    action: Action,
    fetchNewStatus: () => Promise<mastodon.v1.Status>,
    countField?: CountField,
  ) {
    if (!checkLogin())
      return

    const prevCount = countField ? status()[countField] : undefined

    // Functional update, avoid concurrent overwrites
    setIsLoading(prev => ({ ...prev, [action]: true }))
    const isCancel = status()[action]
    // Optimistic update first, a single setStatus keeps it atomic
    const optimistic = { ...status(), [action]: !status()[action] } as mastodon.v1.Status
    if (countField) {
      const delta = optimistic[action] ? 1 : -1
      ;(optimistic as any)[countField] = (optimistic as any)[countField] + delta
    }
    setStatus(optimistic)
    cacheStatus(optimistic, undefined, true)

    fetchNewStatus().then((newStatus) => {
      if (isCancel && countField && prevCount === newStatus[countField])
        (newStatus as any)[countField] -= 1

      setStatus({ ...newStatus })
      cacheStatus(newStatus, undefined, true)
    }).catch(e => console.error(e)).finally(() => {
      setIsLoading(prev => ({ ...prev, [action]: false }))
    })
  }

  const toggleFavourite = () => toggleStatusAction(
    'favourited',
    () => mastoClient().v1.statuses.$select(status().id)[status().favourited ? 'unfavourite' : 'favourite'](),
    'favouritesCount',
  )

  const canReblog = createMemo(() =>
    status().visibility !== 'direct'
    && (status().visibility !== 'private' || status().account.id === currentUser()?.account?.id),
  )

  const toggleReblog = () => toggleStatusAction(
    'reblogged',
    () => mastoClient().v1.statuses.$select(status().id)[status().reblogged ? 'unreblog' : 'reblog']().then((res) => {
      if (status().reblogged)
        return res.reblog!
      return res
    }),
    'reblogsCount',
  )

  const toggleBookmark = () => toggleStatusAction(
    'bookmarked',
    () => mastoClient().v1.statuses.$select(status().id)[status().bookmarked ? 'unbookmark' : 'bookmark'](),
  )

  return {
    status,
    isLoading,
    canReblog,
    toggleReblog,
    toggleFavourite,
    toggleBookmark,
  }
}
