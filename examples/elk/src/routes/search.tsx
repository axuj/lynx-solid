import type { InputEvent } from '@lynx-js/types'
import type { mastodon } from 'masto'
import { createFileRoute } from '@tanstack/solid-router'
import { createSignal, For, Loading, Show } from 'solid-js'
import { AccountAvatar } from '../components/AccountAvatar'
import { AccountDisplayName } from '../components/AccountDisplayName'
import { AppIcon } from '../components/AppIcon'
import { PageHeader } from '../components/PageHeader'
import { Spinner } from '../components/Spinner'
import { StatusCard } from '../components/StatusCard'
import { formatCompactNumber } from '../composables/format'
import { useSearch } from '../composables/search'
import { push } from '../router'

function SearchPage() {
  const [query, setQuery] = createSignal('')
  const { accounts, hashtags, statuses } = useSearch(query)

  function onInput(e: InputEvent) {
    setQuery(e.detail.value ?? '')
  }

  function totalUses(tag: mastodon.v1.Tag): number {
    return (tag.history ?? []).reduce((sum, h) => sum + Number(h.uses ?? 0), 0)
  }

  return (
    <view class="page">
      <PageHeader title="Search" icon="search-line" />
      <view class="search-box">
        <AppIcon name="search-line" size={18} color="#919191" />
        <input
          class="search-input"
          type="text"
          placeholder="Search people, hashtags, posts"
          value={query()}
          bindinput={onInput}
        />
      </view>

      <list class="search-results" scroll-orientation="vertical">
        <Show
          when={query()}
          fallback={(
            <list-item item-key="__hint" estimated-main-axis-size-px={80}>
              <view class="search-hint">
                <text class="search-hint-text">Search for people, hashtags and posts</text>
              </view>
            </list-item>
          )}
        >
          <Loading
            fallback={(
              <list-item item-key="__loading" estimated-main-axis-size-px={80}>
                <view class="search-loading">
                  <Spinner />
                </view>
              </list-item>
            )}
          >
            {accounts().length
              ? (
                  <list-item item-key="__people-title" estimated-main-axis-size-px={32}>
                    <text class="search-section-title">People</text>
                  </list-item>
                )
              : null}
            <For each={accounts().slice(0, 5)}>
              {result => (
                <list-item item-key={result.id} estimated-main-axis-size-px={56}>
                  <view class="search-account" bindtap={() => push(result.to)}>
                    <AccountAvatar account={result.data} size={40} />
                    <view class="search-account-names">
                      <AccountDisplayName account={result.data} fontSize={14} />
                      <text class="search-account-handle">
                        @
                        {result.data.acct}
                      </text>
                    </view>
                  </view>
                </list-item>
              )}
            </For>

            {hashtags().length
              ? (
                  <list-item item-key="__tags-title" estimated-main-axis-size-px={32}>
                    <text class="search-section-title">Hashtags</text>
                  </list-item>
                )
              : null}
            <For each={hashtags().slice(0, 5)}>
              {result => (
                <list-item item-key={result.id} estimated-main-axis-size-px={48}>
                  <view class="search-tag" bindtap={() => push(result.to)}>
                    <AppIcon name="hashtag" size={18} color="#686868" />
                    <text class="search-tag-name">{result.data.name}</text>
                    <text class="search-tag-uses">
                      {formatCompactNumber(totalUses(result.data))}
                      {' '}
                      recent uses
                    </text>
                  </view>
                </list-item>
              )}
            </For>

            {statuses().length
              ? (
                  <list-item item-key="__posts-title" estimated-main-axis-size-px={32}>
                    <text class="search-section-title">Posts</text>
                  </list-item>
                )
              : null}
            <For each={statuses()}>
              {result => (
                <list-item item-key={result.id} estimated-main-axis-size-px={160}>
                  <StatusCard status={result.data} />
                </list-item>
              )}
            </For>

            <Show when={!accounts().length && !hashtags().length && !statuses().length}>
              <list-item item-key="__empty" estimated-main-axis-size-px={80}>
                <view class="search-hint">
                  <text class="search-hint-text">
                    No results for "
                    {query()}
                    "
                  </text>
                </view>
              </list-item>
            </Show>
          </Loading>
        </Show>
      </list>
    </view>
  )
}

export const Route = createFileRoute('/search')({
  component: SearchPage,
})
