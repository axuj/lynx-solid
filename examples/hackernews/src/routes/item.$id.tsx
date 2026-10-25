import { createFileRoute } from '@tanstack/solid-router'
import { ItemPage } from '../pages/ItemPage'

export const Route = createFileRoute('/item/$id')({
  component: () => {
    const params = Route.useParams()
    return <ItemPage itemId={Number(params().id)} />
  },
})
