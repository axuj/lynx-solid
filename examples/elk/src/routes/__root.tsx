import { createRootRoute, Outlet } from '@tanstack/solid-router'
import { MediaPreview } from '../components/MediaPreview'
import { NavBottom } from '../components/NavBottom'
import { getSparklingSafeAreaInsets } from '../composables/safe-area'
import { useUserSettings } from '../composables/settings'

function ElkShell() {
  const settings = useUserSettings()
  const safeArea = getSparklingSafeAreaInsets()
  const safeAreaTopStyle = { height: `${safeArea.top}px` }
  const safeAreaBottomStyle = { height: `${safeArea.bottom}px` }

  return (
    <view
      class={`app-root ${settings.colorMode === 'dark' ? ' app-dark' : ''}`}
    >
      {safeArea.top > 0 && <view class="safe-area-spacer" style={safeAreaTopStyle} />}
      <view class="app-safe-content">
        <view class="app-content">
          <Outlet />
        </view>
        <NavBottom safeAreaBottom={safeArea.bottom} />
        <MediaPreview />
      </view>
      {safeArea.bottom > 0 && <view class="safe-area-spacer" style={safeAreaBottomStyle} />}
    </view>
  )
}

function NotFound() {
  return (
    <view class="page"><text>404</text></view>
  )
}

export const Route = createRootRoute({
  component: ElkShell,
  notFoundComponent: NotFound,
})
