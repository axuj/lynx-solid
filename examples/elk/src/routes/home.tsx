import { createFileRoute } from '@tanstack/solid-router'
import { TimelinePage } from '../components/TimelinePage'

export const Route = createFileRoute('/home')({
  component: () => <TimelinePage kind="home" />,
})
