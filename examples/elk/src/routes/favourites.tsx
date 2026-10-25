import { createFileRoute } from '@tanstack/solid-router'
import { CollectionPage } from '../components/CollectionPage'

export const Route = createFileRoute('/favourites')({
  component: () => <CollectionPage kind="favourites" />,
})
