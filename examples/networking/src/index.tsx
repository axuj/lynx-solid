import { render } from '@lynx-solid/runtime'
// Must be evaluated BEFORE the query library: @tanstack/query-core builds an
// AbortController at module scope and the main thread has none.
import './polyfills'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createOptimistic, createSignal, Errored, For, Loading, Show } from 'solid-js'

// --- Types ---

interface User {
  id: number
  name: string
  email: string
  company: { name: string }
}

interface Post {
  userId: number
  id: number
  title: string
  body: string
}

// --- Styles ---

const styles = {
  root: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f5f5f5',
  },
  container: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    padding: '16px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 'bold' as const,
    marginBottom: '12px',
    color: '#111',
  },
  searchInput: {
    height: '36px',
    fontSize: '14px',
    padding: '0 12px',
    marginBottom: '12px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    borderWidth: '1px',
    borderColor: '#ddd',
  },
  hint: {
    fontSize: '14px',
    color: '#999',
    marginTop: '20px',
    textAlign: 'center' as const,
  },
  error: {
    fontSize: '14px',
    color: '#e53e3e',
    marginTop: '20px',
    textAlign: 'center' as const,
  },
  // User card
  userCard: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    padding: '12px',
    marginBottom: '8px',
    backgroundColor: '#fff',
    borderRadius: '8px',
  },
  userName: {
    fontSize: '16px',
    fontWeight: 'bold' as const,
    color: '#222',
  },
  userMeta: {
    fontSize: '12px',
    color: '#888',
    marginTop: '4px',
  },
  // Back button
  backRow: {
    marginBottom: '12px',
  },
  backText: {
    fontSize: '15px',
    color: '#4c8caf',
    fontWeight: 'bold' as const,
  },
  // Post card
  postCard: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    padding: '12px',
    marginBottom: '8px',
    backgroundColor: '#fff',
    borderRadius: '8px',
  },
  postHeader: {
    display: 'flex' as const,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
  },
  postTitle: {
    fontSize: '14px',
    fontWeight: 'bold' as const,
    color: '#222',
    flex: 1,
  },
  deleteBtn: {
    fontSize: '16px',
    color: '#e53e3e',
    marginLeft: '8px',
    padding: '0 4px',
  },
  postBody: {
    fontSize: '12px',
    color: '#666',
    marginTop: '6px',
    lineHeight: '18px',
  },
}

const client = new QueryClient()

function App() {
  const [search, setSearch] = createSignal('')
  const [selectedUserId, setSelectedUserId] = createSignal<number | null>(null)

  const queryClient = useQueryClient()

  const users = useQuery(() => ({
    queryKey: ['users'],
    queryFn: async (): Promise<User[]> => {
      const res = await fetch('https://jsonplaceholder.typicode.com/users')
      if (!res.ok)
        throw new Error('Failed to fetch users')
      return res.json()
    },
  }))

  const postsKey = (): readonly unknown[] => ['posts', selectedUserId()]

  // Dependent read: the key carries the selection, so switching users is a new
  // query — no effect, no manual clearing of the old list.
  const posts = useQuery(() => ({
    queryKey: postsKey(),
    enabled: selectedUserId() !== null,
    queryFn: async (): Promise<Post[]> => {
      const id = selectedUserId()
      if (id === null)
        return []
      const res = await fetch(`https://jsonplaceholder.typicode.com/users/${id}/posts`)
      if (!res.ok)
        throw new Error('Failed to fetch posts')
      return res.json()
    },
  }))

  // Optimistic layer, v6 style: the mutation rides an `action`, so an overlay
  // written in `onMutate` is visible immediately and dropped when the
  // transition settles — on failure that IS the rollback (no snapshot, no
  // context: v6 does not hand one to the callbacks).
  const [pendingRemoval, setPendingRemoval] = createOptimistic<number[]>([])

  const deletePost = useMutation(() => ({
    mutationFn: async (postId: number): Promise<number> => {
      const res = await fetch(`https://jsonplaceholder.typicode.com/posts/${postId}`, { method: 'DELETE' })
      if (!res.ok)
        throw new Error('Failed to delete post')
      return postId
    },
    // Transient: the row disappears now, and comes back by itself if the
    // request fails.
    onMutate: (postId: number) => {
      setPendingRemoval(prev => [...prev, postId])
    },
    // Durable: jsonplaceholder never persists the DELETE, so the cache is
    // updated here — a real backend would instead invalidate and refetch, and
    // its answer would carry the row gone.
    onSuccess: (_result, postId) => {
      queryClient.setQueryData<Post[]>(postsKey(), old => old?.filter(p => p.id !== postId) ?? [])
    },
  }))

  // The list is the cache plus the optimistic overlay: the overlay hides the
  // row while the request is in flight, the cache is what stays. `lazy` keeps
  // the data read inside the <Loading> boundary (a top-level read would
  // suspend outside it).
  const visiblePosts = createMemo(() => {
    const list = posts.data
    const pending = pendingRemoval()
    if (pending.length === 0)
      return list
    const kept: Post[] = []
    for (const p of list) {
      if (!pending.includes(p.id))
        kept.push(p)
    }
    return kept
  }, { lazy: true })

  // Derived from the query's data read — `lazy` keeps the read inside the
  // <Loading> boundary (a top-level read would suspend outside it).
  const filteredUsers = createMemo(() => {
    const list = users.data
    const q = search().toLowerCase()
    if (!q)
      return list
    const filtered: User[] = []
    for (const u of list) {
      if (u.name.toLowerCase().includes(q) || u.company.name.toLowerCase().includes(q))
        filtered.push(u)
    }
    return filtered
  }, { lazy: true })

  function openUser(userId: number): void {
    setSelectedUserId(userId)
  }

  function back(): void {
    setSelectedUserId(null)
  }

  return (
    <scroll-view style={styles.root} scroll-orientation="vertical">
      <view style={styles.container}>
        <text style={styles.title}>Signals × Lynx</text>

        {/* User List View */}
        <Show
          when={selectedUserId() === null}
          fallback={(
            <>
              <view style={styles.backRow} bindtap={back}>
                <text style={styles.backText}>← Back</text>
              </view>

              <Errored
                fallback={(err, reset) => (
                  <text style={styles.error} bindtap={reset}>
                    {() => `Failed to load posts${err() ? `: ${String(err())}` : ''} — tap to retry`}
                  </text>
                )}
              >
                <Loading fallback={<text style={styles.hint}>Loading posts...</text>}>
                  <For each={visiblePosts()}>
                    {post => (
                      <view style={styles.postCard}>
                        <view style={styles.postHeader}>
                          <text style={styles.postTitle}>{post.title}</text>
                          <text style={styles.deleteBtn} bindtap={() => deletePost.mutate(post.id)}>✕</text>
                        </view>
                        <text style={styles.postBody}>{post.body}</text>
                      </view>
                    )}
                  </For>
                </Loading>
              </Errored>
            </>
          )}
        >
          <input
            style={styles.searchInput}
            value={search()}
            placeholder="Search users..."
            bindinput={e => setSearch(e.detail?.value ?? '')}
          />

          <Errored
            fallback={(err, reset) => (
              <text style={styles.error} bindtap={reset}>
                {() => `Failed to load users${err() ? `: ${String(err())}` : ''} — tap to retry`}
              </text>
            )}
          >
            <Loading fallback={<text style={styles.hint}>Loading users...</text>}>
              <For each={filteredUsers()}>
                {user => (
                  <view
                    style={styles.userCard}
                    bindtap={() => openUser(user.id)}
                  >
                    <text style={styles.userName}>{user.name}</text>
                    <text style={styles.userMeta}>
                      {user.company.name}
                      {' '}
                      ·
                      {' '}
                      {user.email}
                    </text>
                  </view>
                )}
              </For>
              <Show when={filteredUsers().length === 0}>
                <text style={styles.hint}>No matches</text>
              </Show>
            </Loading>
          </Errored>
        </Show>
      </view>
    </scroll-view>
  )
}

render(() => (
  <QueryClientProvider client={client}>
    <App />
  </QueryClientProvider>
))
