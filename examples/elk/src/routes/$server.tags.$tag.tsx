import type { mastodon } from 'masto'
import { createFileRoute } from '@tanstack/solid-router'
import { createEffect, createMemo, createSignal, For, Loading } from 'solid-js'
import { ErrorRetryItem } from '../components/ErrorRetry'
import { PageHeader } from '../components/PageHeader'
import { Spinner } from '../components/Spinner'
import { StatusCard } from '../components/StatusCard'
import { fetchTag } from '../composables/cache'
import { mastoClient } from '../composables/masto'
import { useInfiniteCursor } from '../composables/paginator'
import { checkLogin } from '../composables/users'

export const Route = createFileRoute('/$server/tags/$tag')({
  component: TagPage,
})

function TagPage() {
  const params = Route.useParams()
  const tag = createMemo(() => params().tag)
  const [tagInfo, setTagInfo] = createSignal<mastodon.v1.Tag | null>(null)

  const [pages, loadNext, { reset }] = useInfiniteCursor<mastodon.v1.Status>(
    async (cursor) => {
      const t = tag()
      if (!t)
        return []
      const client = mastoClient()
      const paginator = client.v1.timelines.tag.$select(t).list({ limit: 30, maxId: cursor })
      const page = await paginator
      return page ?? []
    },
  )

  createEffect(() => tag(), (t) => {
    void fetchTag(t)
      .then(setTagInfo)
      .catch(() => {})
  })

  createEffect(
    () => tag(),
    () => {
      reset()
    },
  )

  async function toggleFollowTag() {
    if (!checkLogin() || !tagInfo())
      return
    const client = mastoClient()
    const api = client.v1.tags.$select(tag())
    setTagInfo(tagInfo()!.following ? await api.unfollow() : await api.follow())
  }

  return (
    <view class="page">
      <PageHeader title={`#${tag()}`} back>
        {checkLogin() && tagInfo()
          ? (
              <view
                class={tagInfo()!.following ? 'tag-follow-btn tag-follow-btn-active' : 'tag-follow-btn'}
                bindtap={toggleFollowTag}
              >
                <text class="tag-follow-text" style={tagInfo()!.following ? { color: '#ffffff' } : undefined}>
                  {tagInfo()!.following ? 'Following' : 'Follow'}
                </text>
              </view>
            )
          : null}
      </PageHeader>
      <list
        class="timeline-list"
        scroll-orientation="vertical"
        lower-threshold-item-count={4}
        bindscrolltolower={loadNext}
      >
        <For each={pages()}>
          {page => (
            <ErrorRetryItem label="TagPage" onRetry={() => page.retry()}>
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
    </view>
  )
}
