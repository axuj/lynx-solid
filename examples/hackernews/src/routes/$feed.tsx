import { createFileRoute, Outlet, redirect } from '@tanstack/solid-router'
import { validFeeds } from '../api'

export const Route = createFileRoute('/$feed')({
  beforeLoad: ({ params, location }) => {
    const meta = validFeeds[params.feed]
    if (!meta)
      throw redirect({ to: '/$feed/$page', params: { feed: 'news', page: '1' }, replace: true })
    // Bare /news without a page → redirect to /news/1
    if (location.pathname === `/${params.feed}`)
      throw redirect({ to: '/$feed/$page', params: { feed: params.feed, page: '1' }, replace: true })
  },
  component: FeedLayout,
})

function FeedLayout() {
  return <Outlet />
}
