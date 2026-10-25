import type { InputEvent } from '@lynx-js/types'
import type { mastodon } from 'masto'
import { createFileRoute } from '@tanstack/solid-router'
import { createEffect, createMemo, createSignal, For } from 'solid-js'
import { AppIcon } from '../components/AppIcon'
import { PageHeader } from '../components/PageHeader'
import { StatusCard } from '../components/StatusCard'
import { fetchStatus } from '../composables/cache'
import { mastoClient } from '../composables/masto'
import { checkLogin, currentInstance } from '../composables/users'
import { back } from '../router'

export const Route = createFileRoute('/compose')({
  component: ComposePage,
  validateSearch: (search: Record<string, unknown>) => ({
    replyTo: typeof search.replyTo === 'string' ? search.replyTo : undefined,
  }),
})

function ComposePage() {
  // Typed by this route's validateSearch below: replyTo is
  // string | undefined — no manual narrowing needed.
  const search = Route.useSearch()
  const replyToParam = () => search().replyTo
  const signedIn = createMemo(() => checkLogin())
  const [text, setText] = createSignal('')
  const [visibility, setVisibility] = createSignal<mastodon.v1.StatusVisibility>('public')
  const [posting, setPosting] = createSignal(false)
  const [errorText, setErrorText] = createSignal('')
  const [replyTo, setReplyTo] = createSignal<mastodon.v1.Status | null>(null)

  const maxCharacters = createMemo(() =>
    (currentInstance()?.configuration?.statuses?.maxCharacters as number | undefined) ?? 500,
  )
  const remaining = createMemo(() => maxCharacters() - text().length)

  const visibilities: { key: mastodon.v1.StatusVisibility, icon: string, label: string }[] = [
    { key: 'public', icon: 'earth-line', label: 'Public' },
    { key: 'unlisted', icon: 'lock-line', label: 'Unlisted' },
    { key: 'private', icon: 'lock-line', label: 'Followers' },
    { key: 'direct', icon: 'at-line', label: 'Direct' },
  ]

  // Reactive query read, refetches automatically when the reply target changes
  createEffect(
    () => replyToParam(),
    (replyId) => {
      if (!replyId) {
        setReplyTo(null)
        return
      }
      void fetchStatus(replyId)
        .then(setReplyTo)
        .catch(() => setReplyTo(null))
    },
  )

  function onInput(e: InputEvent) {
    setText(e.detail.value ?? '')
  }

  async function publish() {
    if (!text().trim() || posting() || remaining() < 0)
      return
    setPosting(true)
    setErrorText('')
    const client = mastoClient()
    if (!client) {
      setPosting(false)
      return
    }
    try {
      await client.v1.statuses.create({
        status: text(),
        visibility: visibility(),
        inReplyToId: replyTo()?.id,
      })
      setText('')
      back()
    }
    catch (e: any) {
      setErrorText(e?.message ?? 'Failed to publish.')
    }
    setPosting(false)
  }

  return (
    <view class="page">
      <PageHeader title={replyTo() ? 'Reply' : 'New post'} back />

      {!signedIn()
        ? (
            <view class="compose-empty">
              <AppIcon name="quill-pen-line" size={40} color="#919191" />
              <text class="compose-empty-text">Posting requires a signed-in session. Add an access token in Settings.</text>
            </view>
          )
        : (
            <scroll-view scroll-orientation="vertical" class="compose-scroll">
              {replyTo() && <StatusCard status={replyTo()!} showActions={false} />}

              <view class="compose-editor">
                <textarea
                  class="compose-textarea"
                  placeholder={replyTo() ? 'Write your reply' : 'What is on your mind?'}
                  value={text()}
                  maxlength={maxCharacters()}
                  bindinput={onInput}
                />
              </view>

              <view class="compose-visibilities">
                <For each={visibilities}>
                  {v => (
                    <view
                      class={visibility() === v.key ? 'compose-visibility compose-visibility-active' : 'compose-visibility'}
                      bindtap={() => setVisibility(v.key)}
                    >
                      <AppIcon name={v.icon} size={14} color={visibility() === v.key ? '#cc7d24' : '#686868'} />
                      <text class="compose-visibility-text" style={visibility() === v.key ? { color: '#cc7d24' } : undefined}>
                        {v.label}
                      </text>
                    </view>
                  )}
                </For>
              </view>

              <view class="compose-bar">
                <text class="compose-counter" style={remaining() < 0 ? { color: '#ff3c1b' } : undefined}>
                  {remaining()}
                </text>
                <view
                  class={!text().trim() || posting() || remaining() < 0 ? 'compose-publish compose-publish-disabled' : 'compose-publish'}
                  bindtap={publish}
                >
                  <text class="compose-publish-text">{posting() ? 'Publishing…' : 'Publish!'}</text>
                </view>
              </view>

              {errorText() && <text class="compose-error">{errorText()}</text>}
            </scroll-view>
          )}
    </view>
  )
}
