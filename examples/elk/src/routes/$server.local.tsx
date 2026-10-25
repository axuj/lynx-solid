import { createFileRoute } from '@tanstack/solid-router'
import { TimelinePage } from '../components/TimelinePage'

function LocalTimeline() {
  return <TimelinePage kind="local" />
}

export const Route = createFileRoute('/$server/local')({
  component: LocalTimeline,
})
