import type { mastodon } from 'masto'
import { extractAccountHandle } from './account'
import { cacheAccount } from './cache'
import { currentServer } from './users'

export function getAccountRoute(account: mastodon.v1.Account) {
  cacheAccount(account)
  return `/${currentServer()}/@${extractAccountHandle(account)}`
}

export function getStatusRoute(status: mastodon.v1.Status) {
  return `/${currentServer()}/status/${status.id}`
}

export function getTagRoute(tag: string) {
  return `/${currentServer()}/tags/${tag}`
}
