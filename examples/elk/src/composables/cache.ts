import type { mastodon } from 'masto'
import { mastoClient } from './masto'
import { recoverProfileRequest, retryProfileRequest } from './profile-load'
import { currentServer, currentUser, getInstanceDomainFromServer } from './users'

const MAX_ENTRIES = 1000
const cache = new Map<string, any>()

function cacheGet(key: string): any {
  if (!cache.has(key))
    return undefined
  const value = cache.get(key)
  cache.delete(key)
  cache.set(key, value)
  return value
}

export function setCached(key: string, value: any, override = false) {
  if (override || !cache.has(key)) {
    cache.delete(key)
    cache.set(key, value)
    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value!
      cache.delete(oldest)
    }
  }
}

function removeCached(key: string) {
  cache.delete(key)
}

function userKey() {
  return `${currentServer()}:${currentUser()?.account?.id}`
}

export function fetchStatus(id: string, force = false): Promise<mastodon.v1.Status> {
  const key = `${userKey()}:status:${id}`
  const cached = cacheGet(key)
  if (cached && !force)
    return Promise.resolve(cached)

  const client = mastoClient()
  if (!client)
    return Promise.reject(new Error('no client'))
  const promise = client.v1.statuses.$select(id).fetch().then((status) => {
    cacheStatus(status)
    return status
  }).catch((e) => {
    // A failed promise must not stay cached, or later reads get rejected forever
    removeCached(key)
    throw e
  })
  setCached(key, promise, true)
  return promise
}

export function fetchAccountById(id?: string | null): Promise<mastodon.v1.Account | null> {
  if (!id)
    return Promise.resolve(null)

  const server = currentServer()
  const key = `${userKey()}:account:${id}`
  const cached = cacheGet(key)
  if (cached)
    return Promise.resolve(cached)

  const domain = getInstanceDomainFromServer(server)
  const client = mastoClient()
  if (!client)
    return Promise.resolve(null)
  const promise = client.v1.accounts.$select(id).fetch().then((r) => {
    if (r.acct && !r.acct.includes('@') && domain)
      r.acct = `${r.acct}@${domain}`
    cacheAccount(r, server, true)
    return r
  }).catch((e) => {
    removeCached(key)
    throw e
  })
  setCached(key, promise, true)
  return promise
}

export function fetchAccountByHandle(acct: string): Promise<mastodon.v1.Account> {
  const server = currentServer()
  const domain = getInstanceDomainFromServer(server)
  const userAcct = domain && acct.endsWith(`@${domain}`)
    ? acct.slice(0, -domain.length - 1)
    : acct
  const key = `${userKey()}:account:${userAcct}`
  const cached = cacheGet(key)
  if (cached)
    return Promise.resolve(cached)

  const client = mastoClient()
  if (!client)
    return Promise.reject(new Error('no client'))
  const promise = recoverProfileRequest(
    retryProfileRequest(() => client.v1.accounts.lookup({ acct: userAcct }))
      .then((account) => {
        if (account.acct && !account.acct.includes('@') && domain)
          account.acct = `${account.acct}@${domain}`
        cacheAccount(account, server, true)
        return account
      }),
    () => removeCached(key),
  )
  setCached(key, promise, true)
  return promise
}

export function fetchTag(tagName: string, force = false): Promise<mastodon.v1.Tag> {
  const key = `${userKey()}:tag:${tagName}`
  const cached = cacheGet(key)
  if (cached && !force)
    return Promise.resolve(cached)

  const client = mastoClient()
  if (!client)
    return Promise.reject(new Error('no client'))
  const promise = client.v1.tags.$select(tagName).fetch().then((tag) => {
    cacheTag(tag)
    return tag
  }).catch((e) => {
    removeCached(key)
    throw e
  })
  setCached(key, promise, true)
  return promise
}

export function cacheStatus(status: mastodon.v1.Status, server = currentServer(), override?: boolean) {
  const userId = currentUser()?.account?.id
  setCached(`${server}:${userId}:status:${status.id}`, status, override)
}

export function removeCachedStatus(id: string, server = currentServer()) {
  const userId = currentUser()?.account?.id
  removeCached(`${server}:${userId}:status:${id}`)
}

export function cacheAccount(account: mastodon.v1.Account, server = currentServer(), override?: boolean) {
  const userId = currentUser()?.account?.id
  const userAcct = account.acct.endsWith(`@${server}`)
    ? account.acct.slice(0, -server.length - 1)
    : account.acct
  setCached(`${server}:${userId}:account:${account.id}`, account, override)
  setCached(`${server}:${userId}:account:${userAcct}`, account, override)
}

export function cacheTag(tag: mastodon.v1.Tag, server = currentServer(), override?: boolean) {
  const userId = currentUser()?.account?.id
  setCached(`${server}:${userId}:tag:${tag.name}`, tag, override)
}
