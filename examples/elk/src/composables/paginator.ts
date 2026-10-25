import type { Accessor } from 'solid-js'
import { createMemo, createSignal, getOwner, isDisposed, mapArray } from 'solid-js'
import { formatError } from './format-error'

export interface InfiniteScrollPage<T> {
  content: Accessor<T[]>
  error: Accessor<unknown>
  retry: () => void
}

export function useInfiniteCursor<T>(
  fetcher: (cursor?: string) => Promise<T[]>,
  getCursor: (item: T) => string | undefined = (x: unknown) => (x as { id?: string })?.id,
  options?: { initialCount?: number },
): [
  pages: Accessor<InfiniteScrollPage<T>[]>,
  loadNext: () => void,
  state: { end: Accessor<boolean>, reset: () => void },
] {
  const initialCount = options?.initialCount ?? 1
  const [cursors, setCursors] = createSignal<(string | undefined)[]>(
    initialCount > 0 ? Array.from<undefined>({ length: initialCount }).fill(undefined) : [],
  )
  const [end, setEnd] = createSignal(false)
  const [generation, setGeneration] = createSignal(0)

  const pageKeys = createMemo(() => {
    const gen = generation()
    return cursors().map((_, i) => `${gen}:${i}`)
  })

  const pages = mapArray(pageKeys, (key) => {
    const index = Number(key.slice(key.indexOf(':') + 1))
    const cursor = () => cursors()[index]

    const [error, setError] = createSignal<unknown>(undefined, { ownedWrite: true })
    const [attempt, setAttempt] = createSignal(0, { ownedWrite: true })

    const owner = getOwner()
    let request!: Promise<T[]>
    let currentRequest!: Promise<T[]>

    const stale = (r: Promise<T[]>) => r !== currentRequest || (owner != null && isDisposed(owner))

    const startRequest = () => {
      setError(undefined)
      let p: Promise<T[]>
      try {
        p = fetcher(cursor())
      }
      catch (e) {
        p = Promise.reject(e)
      }
      request = p
      currentRequest = p
      p.then((v) => {
        if (stale(p))
          return
        if (v.length === 0)
          setEnd(true)
      }).catch((e) => {
        if (stale(p))
          return
        // Error ground zero: a real e is guaranteed here, log it fully before entering the boundary
        console.error('[elk:pager] page fetch failed:\n', formatError(e))
        setError(e)
      })
    }

    startRequest()

    const content = createMemo(() => {
      attempt()
      return request
    })

    return {
      content,
      error,
      retry: () => {
        startRequest()
        setAttempt(a => a + 1)
      },
    }
  })

  const loadNext = () => {
    if (end())
      return
    if (!cursors().length) {
      setCursors([undefined])
      return
    }
    const last = pages().at(-1)
    if (!last)
      return
    if (last.error())
      return
    try {
      const v = last.content() as unknown
      if (v instanceof Promise)
        return
    }
    catch {
      return
    }
    const arr = last.content() as T[]
    if (!arr?.length) {
      setEnd(true)
      return
    }
    const lastId = getCursor(arr.at(-1)!)
    setCursors(s => [...s, lastId])
  }

  const reset = () => {
    setEnd(false)
    setGeneration(g => g + 1)
    setCursors(initialCount > 0 ? Array.from<undefined>({ length: initialCount }).fill(undefined) : [])
  }

  return [pages, loadNext, { end, reset }]
}
