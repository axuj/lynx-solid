import { makeMockStatuses } from './mock-data'

function mockPaginator(list: any[], pageSize = 10) {
  return {
    values: () => {
      let cursor = 0
      return {
        next: async () => {
          if (cursor >= list.length)
            return { done: true, value: [] as unknown[] }
          const value = list.slice(cursor, cursor + pageSize)
          cursor += pageSize
          return { done: false, value }
        },
      }
    },
  }
}

function emptyPaginator() {
  return mockPaginator([])
}

const statuses = makeMockStatuses(1)

export function createMockClient(): unknown {
  return {
    v1: {
      timelines: {
        public: { list: (_params: { local?: boolean }) => mockPaginator(statuses) },
        home: { list: () => mockPaginator(statuses) },
        tag: { $select: () => ({ list: () => mockPaginator(statuses) }) },
      },
      statuses: {
        $select: () => ({
          fetch: async () => statuses[0],
          context: { fetch: async () => ({ ancestors: [], descendants: [] }) },
          history: { list: async () => [] },
        }),
      },
      accounts: {
        lookup: async () => statuses[0].account,
        $select: () => ({
          fetch: async () => statuses[0].account,
          statuses: { list: () => mockPaginator(statuses) },
          following: { list: () => emptyPaginator() },
          followers: { list: () => emptyPaginator() },
        }),
      },
      bookmarks: { list: () => emptyPaginator() },
      favourites: { list: () => emptyPaginator() },
      trends: {
        statuses: { list: () => mockPaginator(statuses) },
        tags: { list: () => emptyPaginator() },
        links: { list: () => emptyPaginator() },
      },
      notifications: { list: () => emptyPaginator() },
      tags: {
        $select: () => ({
          fetch: async () => ({ name: 'mock', history: [], following: false }),
          follow: async () => ({}),
          unfollow: async () => ({}),
        }),
      },
    },
    v2: {
      instance: { fetch: async () => ({ domain: 'mock.social', title: 'Mock Instance' }) },
      search: { list: () => emptyPaginator() },
    },
  }
}
