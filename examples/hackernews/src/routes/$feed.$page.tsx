import { createFileRoute, redirect } from '@tanstack/solid-router'
import { validFeeds } from '../api'
import { FeedList } from '../pages/FeedList'

export const Route = createFileRoute('/$feed/$page')({
  beforeLoad: ({ params }) => {
    const { feed, page: rawPage } = params
    const meta = validFeeds[feed]
    if (!meta)
      throw redirect({ to: '/$feed', params: { feed: 'news' }, replace: true })
    const page = Number.parseInt(rawPage, 10)
    if (!Number.isInteger(page) || page < 1 || page > meta.pages) {
      throw redirect({ to: '/$feed', params: { feed }, replace: true })
    }
  },
  component: FeedPage,
})

function FeedPage() {
  const params = Route.useParams()
  return (
    <FeedList
      feed={params().feed}
      page={Number.parseInt(params().page, 10)}
    />
  )
}
