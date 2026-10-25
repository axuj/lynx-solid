import type { mastodon } from 'masto'
import { nameToJSX } from '../content/content-render'

export function AccountDisplayName(props: {
  account: mastodon.v1.Account
  bold?: boolean
  fontSize?: number
}) {
  return (
    <text
      class={(props.bold ?? true) ? 'account-display-name account-display-name-bold' : 'account-display-name'}
      style={{ fontSize: `${props.fontSize ?? 15}px` }}
    >
      {nameToJSX(props.account)}
    </text>
  )
}
