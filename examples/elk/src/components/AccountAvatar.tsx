import type { mastodon } from 'masto'

export function AccountAvatar(props: { account: mastodon.v1.Account, size?: number }) {
  return (
    <image
      src={props.account.avatar}
      class="account-avatar"
      style={{ width: `${props.size ?? 44}px`, height: `${props.size ?? 44}px` }}
    />
  )
}
