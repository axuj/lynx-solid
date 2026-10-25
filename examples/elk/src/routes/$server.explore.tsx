import type { mastodon } from 'masto'
import { createFileRoute } from '@tanstack/solid-router'
import { createEffect, createSignal, For, Loading } from 'solid-js'
import { AppIcon } from '../components/AppIcon'
import { ErrorRetryItem } from '../components/ErrorRetry'
import { PageHeader } from '../components/PageHeader'
import { Spinner } from '../components/Spinner'
import { StatusCard } from '../components/StatusCard'
import { formatCompactNumber } from '../composables/format'
import { mastoClient } from '../composables/masto'
import { useInfiniteCursor } from '../composables/paginator'
import { getTagRoute } from '../composables/routes'
import { filterAndReorderTimeline } from '../composables/timeline'
import { push } from '../router'

function ExplorePage() {
  const [tab, setTab] = createSignal<'posts' | 'tags' | 'links'>('posts')
  const [showIntro, setShowIntro] = createSignal(true)

  const makePostsFetcher = () => {
    const vals = mastoClient().v1.trends.statuses.list({ limit: 20 }).values()
    return async () => {
      const r = await vals.next()
      if (r.done)
        return []
      return filterAndReorderTimeline((r.value ?? []) as mastodon.v1.Status[], 'public')
    }
  }
  const makeTagsFetcher = () => {
    const vals = mastoClient().v1.trends.tags.list({ limit: 20 }).values()
    return async () => {
      const r = await vals.next()
      if (r.done)
        return []
      return (r.value ?? []) as mastodon.v1.Tag[]
    }
  }
  const makeLinksFetcher = () => {
    const vals = mastoClient().v1.trends.links.list({ limit: 20 }).values()
    return async () => {
      const r = await vals.next()
      if (r.done)
        return []
      return (r.value ?? []) as mastodon.v1.TrendLink[]
    }
  }

  const [postsPages, postsLoad] = useInfiniteCursor<mastodon.v1.Status>(makePostsFetcher())
  const [tagsPages, tagsLoad] = useInfiniteCursor<mastodon.v1.Tag>(makeTagsFetcher(), undefined, { initialCount: 0 })
  const [linksPages, linksLoad] = useInfiniteCursor<mastodon.v1.TrendLink>(makeLinksFetcher(), undefined, { initialCount: 0 })

  createEffect(
    () => tab(),
    (next) => {
      if (next === 'tags' && !tagsPages().length)
        tagsLoad()
      else if (next === 'links' && !linksPages().length)
        linksLoad()
    },
  )

  function tagUses(tag: mastodon.v1.Tag): number {
    return (tag.history ?? []).slice(0, 2).reduce((acc, h) => acc + Number(h.uses || 0), 0)
  }

  return (
    <view class="page">
      <PageHeader title="Explore" icon="compass-3-line" />

      <view class="explore-tabs">
        <view class="explore-tab" bindtap={() => setTab('posts')}>
          <text class={tab() === 'posts' ? 'explore-tab-text explore-tab-active' : 'explore-tab-text'}>Posts</text>
          <view class={tab() === 'posts' ? 'explore-tab-underline explore-tab-underline-active' : 'explore-tab-underline'} />
        </view>
        <view class="explore-tab" bindtap={() => setTab('tags')}>
          <text class={tab() === 'tags' ? 'explore-tab-text explore-tab-active' : 'explore-tab-text'}>Hashtags</text>
          <view class={tab() === 'tags' ? 'explore-tab-underline explore-tab-underline-active' : 'explore-tab-underline'} />
        </view>
        <view class="explore-tab" bindtap={() => setTab('links')}>
          <text class={tab() === 'links' ? 'explore-tab-text explore-tab-active' : 'explore-tab-text'}>News</text>
          <view class={tab() === 'links' ? 'explore-tab-underline explore-tab-underline-active' : 'explore-tab-underline'} />
        </view>
      </view>

      {tab() === 'posts' && showIntro() && (
        <view class="explore-intro">
          <AppIcon name="information-line" size={20} color="#cc7d24" />
          <text class="explore-intro-text">These posts from this and other servers in the decentralized network are gaining traction on this server right now.</text>
          <view class="explore-intro-close" bindtap={() => setShowIntro(false)}>
            <AppIcon name="close-line" size={18} color="#686868" />
          </view>
        </view>
      )}

      {tab() === 'posts' && (
        <list
          class="explore-list"
          scroll-orientation="vertical"
          lower-threshold-item-count={4}
          bindscrolltolower={postsLoad}
        >
          <For each={postsPages()}>
            {page => (
              <ErrorRetryItem label="ExplorePage" onRetry={() => page.retry()}>
                <Loading fallback={<list-item item-key="loading" estimated-main-axis-size-px={60}><view class="explore-footer"><Spinner /></view></list-item>}>
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
      )}

      {tab() === 'tags' && (
        <list
          class="explore-list"
          scroll-orientation="vertical"
          lower-threshold-item-count={4}
          bindscrolltolower={tagsLoad}
        >
          <For each={tagsPages()}>
            {page => (
              <ErrorRetryItem label="ExplorePage" onRetry={() => page.retry()}>
                <Loading fallback={<list-item item-key="loading" estimated-main-axis-size-px={60}><view class="explore-footer"><Spinner /></view></list-item>}>
                  <For each={page.content()}>
                    {(tag, i) => (
                      <list-item item-key={tag.name} estimated-main-axis-size-px={64}>
                        <view class="explore-tag" bindtap={() => push(getTagRoute(tag.name))}>
                          <text class="explore-tag-rank">{i() + 1}</text>
                          <view class="explore-tag-names">
                            <text class="explore-tag-name">
                              #
                              {tag.name}
                            </text>
                            <text class="explore-tag-uses">
                              {formatCompactNumber(tagUses(tag))}
                              {' '}
                              people in the past 2 days
                            </text>
                          </view>
                          <AppIcon name="fire-line" size={18} color="#cc7d24" />
                        </view>
                      </list-item>
                    )}
                  </For>
                </Loading>
              </ErrorRetryItem>
            )}
          </For>
        </list>
      )}

      {tab() === 'links' && (
        <list
          class="explore-list"
          scroll-orientation="vertical"
          lower-threshold-item-count={4}
          bindscrolltolower={linksLoad}
        >
          <For each={linksPages()}>
            {page => (
              <ErrorRetryItem label="ExplorePage" onRetry={() => page.retry()}>
                <Loading fallback={<list-item item-key="loading" estimated-main-axis-size-px={60}><view class="explore-footer"><Spinner /></view></list-item>}>
                  <For each={page.content()}>
                    {link => (
                      <list-item item-key={link.url} estimated-main-axis-size-px={96}>
                        <view class="explore-link">
                          {link.image && (
                            <image src={link.image} class="explore-link-img" mode="aspectFill" />
                          )}
                          <view class="explore-link-body">
                            <text class="explore-link-host">{link.providerName || link.url.replace(/^https?:\/\//, '').split('/')[0]}</text>
                            <text class="explore-link-title" text-maxline="2">{link.title}</text>
                            {link.description && (
                              <text class="explore-link-desc" text-maxline="2">{link.description}</text>
                            )}
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
      )}
    </view>
  )
}

export const Route = createFileRoute('/$server/explore')({
  component: ExplorePage,
})
