import { createFileRoute } from '@tanstack/solid-router'
import { TimelinePage } from '../components/TimelinePage'

function FederatedTimeline() {
  return <TimelinePage kind="public" />
}

export const Route = createFileRoute('/$server/public')({
  component: FederatedTimeline,
})
