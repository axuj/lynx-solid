import type { mastodon } from 'masto'
import { createFileRoute } from '@tanstack/solid-router'
import { createMemo, createSignal, Errored, For, Loading } from 'solid-js'
import { ContentRich } from '../components/ContentRich'
import { ErrorRetry } from '../components/ErrorRetry'
import { PageHeader } from '../components/PageHeader'
import { Spinner } from '../components/Spinner'
import { StatusCard } from '../components/StatusCard'
import { fetchStatus } from '../composables/cache'
import { formatFullDate } from '../composables/format'
import { mastoClient } from '../composables/masto'

export const Route = createFileRoute('/$server/status/$id')({
  component: StatusPage,
})

function StatusPage() {
  const params = Route.useParams()
  // Reruns automatically on route param change; Solid 2 async memo dedupes stale requests
  const statusId = createMemo(() => params().id)

  const status = createMemo(async () => {
    const id = statusId()
    if (!id)
      throw new Error('missing status id')
    return fetchStatus(id)
  })

  const context = createMemo(async () => {
    const s = await status()
    return mastoClient().v1.statuses.$select(s.id).context.fetch()
  })

  const ancestors = createMemo(async () => (await context()).ancestors)
  const descendants = createMemo(async () => (await context()).descendants)

  // Edit history: loaded on demand, avoids one extra first-screen request
  const [showHistory, setShowHistory] = createSignal(false)
  const history = createMemo(async () => {
    if (!showHistory())
      return null
    const s = await status()
    const c = mastoClient()
    if (!c)
      return null
    const versions = await c.v1.statuses.$select(s.id).history.list()
    return [...versions].reverse()
  })

  function toggleHistory() {
    setShowHistory(v => !v)
  }

  return (
    <view class="page">
      <PageHeader title="Post" back />
      <Loading fallback={<view class="thread-loading"><Spinner /></view>}>
        <ErrorRetry label="StatusPage">
          <ThreadBody
            status={status as unknown as import('solid-js').Accessor<mastodon.v1.Status>}
            ancestors={ancestors as unknown as import('solid-js').Accessor<mastodon.v1.Status[]>}
            descendants={descendants as unknown as import('solid-js').Accessor<mastodon.v1.Status[]>}
            history={history as unknown as import('solid-js').Accessor<mastodon.v1.StatusEdit[] | null>}
            toggleHistory={toggleHistory}
            showHistory={showHistory}
          />
        </ErrorRetry>
      </Loading>
    </view>
  )
}

function ThreadBody(props: {
  status: import('solid-js').Accessor<mastodon.v1.Status>
  ancestors: import('solid-js').Accessor<mastodon.v1.Status[]>
  descendants: import('solid-js').Accessor<mastodon.v1.Status[]>
  history: import('solid-js').Accessor<mastodon.v1.StatusEdit[] | null>
  toggleHistory: () => void
  showHistory: import('solid-js').Accessor<boolean>
}) {
  const s = () => props.status()
  return (
    <scroll-view scroll-orientation="vertical" class="thread-scroll">
      <For each={props.ancestors()}>
        {a => (
          <view class="thread-ancestor">
            <StatusCard status={a} />
          </view>
        )}
      </For>
      <StatusCard status={s()} main />
      <view class="thread-date-row">
        <text class="thread-date">{formatFullDate(s().createdAt)}</text>
        {s().editedAt && (
          <text class="thread-edited" bindtap={props.toggleHistory}>
            {`· Edited ${formatFullDate(s().editedAt ?? s().createdAt)} (${props.showHistory() && props.history() ? 'hide history' : 'view history'})`}
          </text>
        )}
      </view>
      {props.showHistory() && (
        <Loading fallback={<view class="thread-history"><Spinner /></view>}>
          <Errored fallback={() => <view class="thread-history"><text class="thread-error">Failed to load history.</text></view>}>
            {props.history()
              ? (
                  <view class="thread-history">
                    <For each={props.history()!}>
                      {(edit, i) => (
                        <view class="thread-history-item">
                          <text class="thread-history-date">{i() === 0 ? 'Latest' : formatFullDate(edit.createdAt)}</text>
                          <ContentRich content={edit.content} emojis={edit.emojis} />
                        </view>
                      )}
                    </For>
                  </view>
                )
              : null}
          </Errored>
        </Loading>
      )}
      <view class="thread-divider" />
      <For each={props.descendants()}>
        {d => <StatusCard status={d} />}
      </For>
      <view class="thread-bottom-pad" />
    </scroll-view>
  )
}
