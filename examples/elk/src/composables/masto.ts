import type { mastodon } from 'masto'
import type { UserLogin } from './users'
import { createRestAPIClient } from 'masto'
import { createSignal } from 'solid-js'
import { setCurrentUser, setPublicInstance, setPublicServer } from './users'

const [mastoClient, setMastoClient] = createSignal<mastodon.rest.Client>(null as unknown as mastodon.rest.Client)

export { mastoClient }

export function mastoLogin(user: UserLogin) {
  const c = createRestAPIClient({
    url: `https://${user.server}`,
    accessToken: user.token,
    timeout: 15_000,
  })
  setMastoClient(c)

  if (user.token) {
    setCurrentUser(user)
    c.v1.accounts.verifyCredentials()
      .then((account) => {
        setCurrentUser({ ...user, account: account as unknown as mastodon.v1.Account })
      })
      .catch(() => {})
  }
  else {
    setPublicServer(user.server)
  }

  c.v2.instance.fetch()
    .then((instance) => {
      setPublicInstance(instance as unknown as mastodon.v2.Instance)
    })
    .catch(() => {})
}
