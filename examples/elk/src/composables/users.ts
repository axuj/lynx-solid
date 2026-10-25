import type { mastodon } from 'masto'
import { createMemo, createSignal } from 'solid-js'

export interface UserLogin {
  server: string
  token?: string
  account?: mastodon.v1.Account
}

export const DEFAULT_SERVER = 'mas.to'

export const [currentUser, setCurrentUser] = createSignal<UserLogin | undefined>()
export const [publicServer, setPublicServer] = createSignal(DEFAULT_SERVER)
export const [publicInstance, setPublicInstance] = createSignal<mastodon.v2.Instance | null>(null)

export const currentServer = createMemo<string>(
  () => currentUser()?.server || publicServer(),
)
export const currentInstance = createMemo<mastodon.v2.Instance | null>(
  () => publicInstance(),
)

export function getInstanceDomain(instance: mastodon.v2.Instance) {
  return instance.domain
}

export function getInstanceDomainFromServer(server: string) {
  return currentInstance() && currentServer() === server
    ? getInstanceDomain(currentInstance()!)
    : server
}

export function checkLogin() {
  return !!currentUser()?.token
}
