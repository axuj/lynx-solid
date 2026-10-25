import { createFileRoute } from '@tanstack/solid-router'
import { FollowList } from '../components/FollowList'

export const Route = createFileRoute('/$server/$account/followers')({
  component: FollowersListPage,
})

function FollowersListPage() {
  const params = Route.useParams()
  return <FollowList kind="followers" account={params().account} />
}
