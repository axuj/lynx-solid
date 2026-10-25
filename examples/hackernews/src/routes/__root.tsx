import { createRootRoute, Outlet } from '@tanstack/solid-router'
import { For } from 'solid-js'
import { validFeeds } from '../api'
import { currentPath, push } from '../router'

const feedKeys = Object.keys(validFeeds)

function HackerNewsShell() {
  const activeFeed = () => {
    const path = currentPath()
    return feedKeys.find(key => path === `/${key}` || path.startsWith(`/${key}/`)) ?? ''
  }

  function goHome() {
    push('/news')
  }

  return (
    <page class="w-full h-full bg-hn-bg">
      {/* Layout lives on an inner <view>, not <page>: Lynx for Web maps page
          to div[part=page] which doesn't resolve Tailwind flex utilities —
          the real <view> applies flex-col correctly. */}
      <view
        class="w-full h-full flex flex-col"
        style={{ flexDirection: 'column' }}
      >
        {/* Header: 55px, matching reference */}
        <view
          class="bg-hn-green flex flex-col"
          style={{ height: '55px', flexShrink: '0' }}
        >
          <scroll-view
            scroll-x
            scroll-orientation="horizontal"
            class="flex-1"
            style={{ height: '100%' }}
          >
            <view
              class="flex flex-row items-center h-full"
              style={{ minWidth: '100%' }}
            >
              {/* Logo: YC-style square border */}
              <view
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '15px', marginRight: '12px' }}
              >
                <view
                  class="flex-shrink-0"
                  style={{
                    width: '26px',
                    height: '26px',
                    borderWidth: '1px',
                    borderColor: '#fff',
                    borderRadius: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  bindtap={goHome}
                >
                  <text
                    style={{ color: '#fff', fontSize: '16px', fontWeight: '700', lineHeight: '26px' }}
                  >
                    Y
                  </text>
                </view>
              </view>

              {/* Feed nav links */}
              <For each={feedKeys}>
                {key => (
                  <view
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <text
                      bindtap={() => push(`/${key}`)}
                      style={{
                        color: '#fff',
                        fontSize: '15px',
                        fontWeight: activeFeed() === key ? '600' : '300',
                        letterSpacing: '0.075em',
                        lineHeight: '24px',
                        marginRight: '1.8em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {validFeeds[key].title}
                    </text>
                  </view>
                )}
              </For>

              {/* Built with LynxSolid */}
              <view
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 'auto', marginRight: '15px' }}
              >
                <text
                  style={{ color: '#fff', fontSize: '14px', fontWeight: '300', letterSpacing: '0.075em', whiteSpace: 'nowrap', flexShrink: '0' }}
                >
                  Built with LynxSolid
                </text>
              </view>
            </view>
          </scroll-view>
        </view>

        {/* Route content */}
        <view
          class="flex flex-col flex-1"
          style={{ minHeight: '0px', width: '100%', flexDirection: 'column' }}
        >
          <Outlet />
        </view>
      </view>
    </page>
  )
}

function NotFound() {
  return (
    <page class="w-full h-full bg-hn-bg">
      <view class="items-center" style={{ padding: '40px' }}>
        <text style={{ fontSize: '15px', color: '#e53e3e' }}>404</text>
      </view>
    </page>
  )
}

export const Route = createRootRoute({
  component: HackerNewsShell,
  notFoundComponent: NotFound,
})
