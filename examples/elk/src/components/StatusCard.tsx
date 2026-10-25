import type { mastodon } from 'masto'
import { createMemo } from 'solid-js'
import { getServerName } from '../composables/account'
import { formatTimeAgo } from '../composables/format'
import { getAccountRoute, getStatusRoute } from '../composables/routes'
import { push } from '../router'
import { AccountAvatar } from './AccountAvatar'
import { AccountDisplayName } from './AccountDisplayName'
import { AppIcon } from './AppIcon'
import { ContentRich } from './ContentRich'
import { StatusActionsBar } from './StatusActionsBar'
import { StatusMedia } from './StatusMedia'
import { StatusPoll } from './StatusPoll'
import { StatusPreviewCard } from './StatusPreviewCard'
import { StatusSpoiler } from './StatusSpoiler'

export function StatusCard(props: {
  status: mastodon.v1.Status
  main?: boolean
  showActions?: boolean
}) {
  const isReblog = createMemo(() => !!props.status.reblog)
  const status = createMemo(() => props.status.reblog ?? props.status)

  const fullHandle = createMemo(() => {
    const acct = status().account.acct
    return acct.includes('@') ? `@${acct}` : `@${acct}@${getServerName(status().account)}`
  })

  const quotedStatus = createMemo(() => {
    const quote = (status() as any).quote
    return quote?.state === 'accepted' ? (quote.quotedStatus as mastodon.v1.Status) : null
  })

  const visibilityIcon = createMemo(() => {
    switch (status().visibility) {
      case 'unlisted': return 'lock-line'
      case 'private': return 'lock-line'
      case 'direct': return 'at-line'
      default: return null
    }
  })

  function openStatus() {
    if (!(props.main ?? false))
      push(getStatusRoute(status()))
  }

  function openAccount() {
    push(getAccountRoute(status().account))
  }

  return (
    <view class={props.main ? 'status-card status-card-main' : 'status-card'}>
      {isReblog() && (
        <view class="status-reblog-line">
          <AppIcon name="repeat-fill" size={14} color="#16a34a" />
          <AccountDisplayName account={props.status.account} bold={false} fontSize={13} />
          <text class="status-reblog-text">boosted</text>
        </view>
      )}

      <view class="status-row">
        <view bindtap={openAccount}>
          <AccountAvatar account={status().account} size={props.main ? 56 : 48} />
        </view>

        <view class="status-body">
          <view class="status-name-row" bindtap={openAccount}>
            <view class="status-names">
              <view class="status-name-line">
                <AccountDisplayName account={status().account} fontSize={props.main ? 16 : 15} />
                {status().account.bot && <AppIcon name="robot-2-line" size={14} color="#919191" />}
                {status().account.locked && <AppIcon name="lock-line" size={13} color="#919191" />}
              </view>
              <text class="status-handle" text-maxline="1">{fullHandle()}</text>
            </view>
            {visibilityIcon() ? <AppIcon name={visibilityIcon()!} size={14} color="#919191" /> : null}
            {!(props.main ?? false) && <text class="status-time">{formatTimeAgo(status().createdAt)}</text>}
          </view>

          {status().inReplyToId && (
            <view class="status-replying">
              <AppIcon name="chat-1-line" size={12} color="#919191" />
              <text class="status-replying-text">replying to a thread</text>
            </view>
          )}

          <view class="status-content" bindtap={openStatus}>
            {status().spoilerText
              ? (
                  <StatusSpoiler spoilerText={status().spoilerText}>
                    <ContentRich
                      content={status().content}
                      emojis={status().emojis}
                      mentions={status().mentions}
                      collapseMentionLink={true}
                      status={status()}
                    />
                  </StatusSpoiler>
                )
              : status().content
                ? (
                    <ContentRich
                      content={status().content}
                      emojis={status().emojis}
                      mentions={status().mentions}
                      collapseMentionLink={true}
                      status={status()}
                    />
                  )
                : null}
          </view>

          {status().mediaAttachments?.length
            ? (
                <StatusMedia attachments={status().mediaAttachments} sensitive={status().sensitive} />
              )
            : null}

          {quotedStatus() && (
            <view class="status-quote" bindtap={() => push(getStatusRoute(quotedStatus()!))}>
              <view class="status-quote-head">
                <AccountAvatar account={quotedStatus()!.account} size={20} />
                <AccountDisplayName account={quotedStatus()!.account} fontSize={13} />
                <text class="status-handle" text-maxline="1">
                  @
                  {quotedStatus()!.account.acct}
                </text>
              </view>
              {quotedStatus()!.content && (
                <ContentRich
                  content={quotedStatus()!.content}
                  emojis={quotedStatus()!.emojis}
                  mentions={quotedStatus()!.mentions}
                />
              )}
            </view>
          )}
          {status().poll
            ? (
                <StatusPoll poll={status().poll!} />
              )
            : status().card && !status().mediaAttachments?.length
              ? (
                  <StatusPreviewCard card={status().card!} />
                )
              : null}

          {(props.showActions ?? true) && <StatusActionsBar status={status()} />}
        </view>
      </view>
    </view>
  )
}
