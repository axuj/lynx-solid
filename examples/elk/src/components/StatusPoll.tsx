import type { mastodon } from 'masto'
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js'
import { formatCompactNumber } from '../composables/format'
import { mastoClient } from '../composables/masto'
import { checkLogin } from '../composables/users'

export function StatusPoll(props: { poll: mastodon.v1.Poll }) {
  const [poll, setPoll] = createSignal({ ...untrack(() => props.poll) })
  // Sync when the parent poll updates, so timeline refreshes don't leave stale vote counts
  createEffect(() => props.poll, (next) => {
    setPoll({ ...next })
  })
  const [hint, setHint] = createSignal('')
  let hintTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (hintTimer)
      clearTimeout(hintTimer)
  })

  const totalVotes = createMemo(() => poll().votersCount ?? poll().votesCount ?? 0)

  function percentage(option: mastodon.v1.PollOption): number {
    const total = totalVotes()
    if (!total || option.votesCount == null)
      return 0
    return Math.round((option.votesCount / total) * 100)
  }

  const expired = createMemo(() => {
    const p = poll()
    return !!(p.expired || (p.expiresAt && new Date(p.expiresAt).getTime() < Date.now()))
  })

  async function vote(index: number) {
    if (expired())
      return
    if (!checkLogin()) {
      // Prompt when signed out instead of failing silently
      setHint('Sign in (Settings → server + token) to vote')
      if (hintTimer)
        clearTimeout(hintTimer)
      hintTimer = setTimeout(() => setHint(''), 3500)
      return
    }
    if (poll().voted)
      return
    const client = mastoClient()
    if (!client)
      return
    const result = await client.v1.polls.$select(poll().id).votes.create({ choices: [index] })
    setPoll({ ...result })
  }

  return (
    <view class="status-poll">
      <For each={poll().options}>
        {(option, i) => (
          <view class="status-poll-option" bindtap={() => vote(i())}>
            <view class="status-poll-bar" style={{ width: `${Math.max(percentage(option), 1)}%` }} />
            <view class="status-poll-row">
              <text class="status-poll-pct">
                {percentage(option)}
                %
              </text>
              <text class="status-poll-title">{option.title}</text>
            </view>
          </view>
        )}
      </For>
      <text class="status-poll-meta">
        {formatCompactNumber(totalVotes())}
        {' '}
        votes
        {expired() ? ' · Closed' : ''}
        {poll().voted ? ' · Voted' : ''}
      </text>
      <Show when={hint()}>
        <text class="status-poll-hint">{hint()}</text>
      </Show>
    </view>
  )
}
