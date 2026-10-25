import { createFileRoute } from '@tanstack/solid-router'
import { UserPage } from '../pages/UserPage'

export const Route = createFileRoute('/user/$id')({
  component: () => {
    const params = Route.useParams()
    return <UserPage userId={params().id} />
  },
})
