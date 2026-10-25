import type { Card } from './data'

import { createSignal } from 'solid-js'
import { makeCards } from './data'

/**
 * Tiny infinite-scroll helper: append another page when the list
 * fires `bindscrolltolower`. On Web you would usually wire this to a
 * virtualizer + IntersectionObserver; on Lynx the helper only owns
 * the data page — append-only updates are the supported list path today.
 */
export function useInfiniteFeed(pageSize = 20) {
  const [items, setItems] = createSignal<Card[]>(makeCards(pageSize, 'Post'))
  const [loading, setLoading] = createSignal(false)
  const [done, setDone] = createSignal(false)
  let page = 1

  async function loadMore(): Promise<void> {
    if (loading() || done())
      return
    setLoading(true)
    // Simulate network latency so the footer spinner is visible.
    await new Promise(resolve => setTimeout(resolve, 400))
    const next = makeCards(pageSize, 'Post').map((card, i) => {
      const n = page * pageSize + i + 1
      return {
        ...card,
        id: `Post-${n}`,
        title: `Post ${n}`,
        body: `A short description for post ${n}.`,
      }
    })
    page += 1
    setItems(prev => [...prev, ...next])
    if (page >= 5)
      setDone(true)
    setLoading(false)
  }

  return { items, loading, done, loadMore }
}
