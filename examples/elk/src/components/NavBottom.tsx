import type { NavigationItem } from '../composables/nav-items'
import { createEffect, createMemo, createSignal, For } from 'solid-js'
import { buildBottomTabs, buildMoreMenuItems } from '../composables/nav-items'
import { setColorMode, toggleZenMode, useUserSettings } from '../composables/settings'
import { currentServer, currentUser } from '../composables/users'
import { currentPath, push } from '../router'
import { AppIcon } from './AppIcon'
import { Sheet } from './sheet/Sheet'

export function NavBottom(props: { safeAreaBottom?: number }) {
  const settings = useUserSettings()
  const [sheetVisible, setSheetVisible] = createSignal(false)
  const [pressedTab, setPressedTab] = createSignal<string | null>(null)
  const [pressedMenuItem, setPressedMenuItem] = createSignal<string | null>(null)

  const authenticated = createMemo(() => !!currentUser()?.token)
  const tabs = createMemo(() =>
    buildBottomTabs({
      authenticated: authenticated(),
      server: currentServer(),
    }),
  )
  const menuItems = createMemo(() =>
    buildMoreMenuItems({
      authenticated: authenticated(),
      server: currentServer(),
      activePath: currentPath(),
    }),
  )
  const sheetBottomInset = createMemo(() => 56 + (props.safeAreaBottom ?? 0))

  createEffect(
    () => currentPath(),
    () => {
      setSheetVisible(false)
    },
  )

  function isTabActive(tab: NavigationItem): boolean {
    if (tab.kind === 'more')
      return sheetVisible()
    if (!tab.to)
      return false
    if (tab.key === 'federated')
      return currentPath() === tab.to
    return currentPath() === tab.to || currentPath().startsWith(`${tab.to}/`)
  }

  function tabIconColor(tab: NavigationItem): string {
    return isTabActive(tab) ? '#cc7d24' : settings.colorMode === 'dark' ? '#888888' : '#686868'
  }

  function menuIconColor(item: NavigationItem): string {
    if (item.disabled)
      return settings.colorMode === 'dark' ? '#4d4d4d' : '#bdbdbd'
    if (item.active)
      return '#cc7d24'
    return settings.colorMode === 'dark' ? '#f3f3f3' : '#232323'
  }

  function releaseTab() {
    setPressedTab(null)
  }

  function releaseMenuItem() {
    setPressedMenuItem(null)
  }

  function selectTab(tab: NavigationItem) {
    if (tab.kind === 'more') {
      setSheetVisible(!sheetVisible())
      return
    }
    if (tab.to) {
      setSheetVisible(false)
      push(tab.to)
    }
  }

  function selectMenuItem(item: NavigationItem) {
    if (item.disabled || !item.to)
      return
    setSheetVisible(false)
    push(item.to)
  }

  function toggleTheme() {
    setColorMode(settings.colorMode === 'dark' ? 'light' : 'dark')
  }

  return (
    <view class="nav-shell">
      <Sheet
        open={sheetVisible()}
        onClose={() => setSheetVisible(false)}
        bottomInset={sheetBottomInset()}
        topInset={144}
        dismissDistance={120}
      >
        <view class="nav-sheet-content">
          <view class="nav-sheet-routes">
            <For each={menuItems()}>
              {item => (
                <view
                  class={`nav-sheet-item ${item.active ? 'nav-sheet-item-active' : ''} ${item.disabled ? 'nav-sheet-item-disabled' : ''} ${pressedMenuItem() === item.key ? 'nav-sheet-item-pressed' : ''}`}
                  bindtouchstart={() => setPressedMenuItem(item.key)}
                  bindtouchend={releaseMenuItem}
                  bindtouchcancel={releaseMenuItem}
                  bindtap={() => selectMenuItem(item)}
                >
                  <AppIcon name={item.icon} size={20} color={menuIconColor(item)} />
                  <text class="nav-sheet-item-label">{item.label}</text>
                </view>
              )}
            </For>
          </view>

          <view class="nav-sheet-divider" />

          <view class="nav-sheet-item nav-sheet-function" bindtap={toggleTheme}>
            <AppIcon
              name={settings.colorMode === 'dark' ? 'moon-line' : 'sun-line'}
              size={20}
              color={settings.colorMode === 'dark' ? '#f3f3f3' : '#232323'}
            />
            <text class="nav-sheet-item-label">
              {settings.colorMode === 'dark' ? 'Toggle Light Mode' : 'Toggle Dark Mode'}
            </text>
          </view>
          <view class="nav-sheet-item nav-sheet-function" bindtap={toggleZenMode}>
            <AppIcon
              name={settings.zenMode ? 'layout-right-2-line' : 'layout-right-line'}
              size={20}
              color={settings.colorMode === 'dark' ? '#f3f3f3' : '#232323'}
            />
            <text class="nav-sheet-item-label">Zen Mode</text>
          </view>
        </view>
      </Sheet>

      <view class="nav-bottom">
        <For each={tabs()}>
          {tab => (
            <view
              class={`nav-bottom-tab ${isTabActive(tab) ? 'nav-bottom-tab-active' : ''} ${pressedTab() === tab.key ? 'nav-bottom-tab-pressed' : ''}`}
              bindtouchstart={() => setPressedTab(tab.key)}
              bindtouchend={releaseTab}
              bindtouchcancel={releaseTab}
              bindtap={() => selectTab(tab)}
            >
              <AppIcon
                name={tab.kind === 'more' && sheetVisible() ? 'close-line' : tab.icon}
                size={22}
                color={tabIconColor(tab)}
              />
            </view>
          )}
        </For>
      </view>
    </view>
  )
}
