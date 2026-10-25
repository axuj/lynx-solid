import { createFileRoute, redirect } from '@tanstack/solid-router'
import { currentUser, publicServer } from '../composables/users'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const user = currentUser()
    if (user?.token) {
      throw redirect({ to: '/home', replace: true })
    }
    // Read raw signals (not the currentServer memo): beforeLoad runs outside
    // a reactive scope, and memos can go stale there without a tracker.
    throw redirect({
      to: '/$server/local',
      params: { server: user?.server ?? publicServer() },
      replace: true,
    })
  },
})
