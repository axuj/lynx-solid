import { createFileRoute } from '@tanstack/solid-router'
import { FollowList } from '../components/FollowList'

export const Route = createFileRoute('/$server/$account/following')({
  component: FollowingListPage,
})

function FollowingListPage() {
  const params = Route.useParams()
  return <FollowList kind="following" account={params().account} />
}
