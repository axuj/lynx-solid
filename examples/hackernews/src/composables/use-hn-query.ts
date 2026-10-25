import { createEffect, createSignal } from 'solid-js'

// Vue-version parity query helper. TanStack Vue Query exposes
// data / isLoading / isFetching / isError; Solid 2 async-memo gives only a
// pending-resolve two-state. To drive the vue three-state FeedList template
// (full-screen spinner / red error text / top refetch indicator + kept
// previous list) we track those states explicitly:
//
//   - data:        last resolved payload (never cleared on refetch/page switch,
//                  so keepPreviousData semantics are free)
//   - isLoading:   no data yet AND a fetch in flight (cold start)
//   - isFetching:  a fetch is in flight, regardless of data presence
//   - isError:     last attempt threw (only surfaced when there's nothing to show)
//
// A module-level cache mirrors resolved payloads with a timestamp so
// prefetchHnQuery can warm keys and staleTime keeps refetches bounded.

const STALE_MS = 5 * 60 * 1000

const cache = new Map<string, { value: unknown, at: number }>()

// Share in-flight fetches by key so parallel consumers dedupe.
const inFlight = new Map<string, Promise<unknown>>()

export interface HnQueryState<T> {
  data: () => T | undefined
  isLoading: () => boolean
  isFetching: () => boolean
  isError: () => boolean
}

export function useHnQuery<T>(
  key: () => string,
  fetcher: (key: string) => Promise<T>,
): HnQueryState<T> {
  const [data, setData] = createSignal<T | undefined>(undefined)
  const [fetching, setFetching] = createSignal(false)
  const [error, setError] = createSignal<unknown>(null)

  createEffect(
    // compute: track the key; effectFn receives the new key on each run.
    () => key(),
    (k) => {
      // Fresh cache hit: synchronous, no network, nothing pending.
      const cached = cache.get(k)
      if (cached && Date.now() - cached.at < STALE_MS) {
        setData(() => cached.value as T) // as: module cache erases T to unknown
        setError(null)
        setFetching(false)
        return
      }

      setFetching(true)
      let active = true
      fetchOrCache(k, fetcher)
        .then((v) => {
          if (!active)
            return
          setData(() => v)
          setError(null)
        })
        .catch((e) => {
          if (!active)
            return
          // Keep whatever data we had (keepPreviousData); remember the error.
          setError(e)
        })
        .finally(() => {
          if (active)
            setFetching(false)
        })
      return () => {
        active = false
      }
    },
  )

  return {
    data,
    isLoading: () => fetching() && data() === undefined,
    isFetching: fetching,
    isError: () => error() !== null && data() === undefined,
  }
}

async function fetchOrCache<T>(key: string, fetcher: (key: string) => Promise<T>): Promise<T> {
  const pending = inFlight.get(key)
  if (pending)
    return pending as Promise<T>
  const p = fetcher(key)
    .then((v) => {
      cache.set(key, { value: v, at: Date.now() })
      return v
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, p)
  return p
}

export function prefetchHnQuery<T>(key: string, fetcher: (key: string) => Promise<T>): void {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < STALE_MS)
    return
  if (inFlight.has(key))
    return
  fetcher(key)
    .then((data) => {
      cache.set(key, { value: data, at: Date.now() })
    })
    .catch(() => {})
}

export function clearHnCache(): void {
  cache.clear()
}
