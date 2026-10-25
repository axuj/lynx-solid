import type { InputEvent } from '@lynx-js/types'
import { createFileRoute } from '@tanstack/solid-router'
import { createSignal } from 'solid-js'
import { AppIcon } from '../components/AppIcon'
import { PageHeader } from '../components/PageHeader'
import { mastoLogin } from '../composables/masto'
import { setColorMode, togglePreference, useUserSettings } from '../composables/settings'
import { currentServer, currentUser, DEFAULT_SERVER, publicServer, setCurrentUser } from '../composables/users'

function SettingsPage() {
  const settings = useUserSettings()

  const [server, setServer] = createSignal(currentServer())
  const [token, setToken] = createSignal('')
  const [switching, setSwitching] = createSignal(false)

  function onServerInput(e: InputEvent) {
    setServer(e.detail.value ?? '')
  }

  function onTokenInput(e: InputEvent) {
    setToken(e.detail.value ?? '')
  }

  async function apply() {
    const s = server().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!s || switching())
      return
    setSwitching(true)
    try {
      mastoLogin({ server: s, token: token().trim() || undefined })
    }
    finally {
      setSwitching(false)
    }
  }

  function signOut() {
    setCurrentUser(undefined)
    setToken('')
    mastoLogin({ server: publicServer() || DEFAULT_SERVER })
  }

  return (
    <view class="page">
      <PageHeader title="Settings" icon="settings-3-line" />
      <scroll-view scroll-orientation="vertical" class="settings-scroll">
        <text class="settings-section">Instance</text>
        <view class="settings-card">
          <text class="settings-label">Server</text>
          <input
            class="settings-input"
            type="text"
            value={server()}
            placeholder="mastodon.social"
            bindinput={onServerInput}
          />
          <text class="settings-label">Access token (optional — enables home timeline, notifications, posting)</text>
          <input
            class="settings-input"
            type="text"
            value={token()}
            placeholder="Paste a personal access token"
            bindinput={onTokenInput}
          />
          <view class="settings-row">
            <view class="settings-btn" bindtap={apply}>
              <AppIcon name="login-circle-line" size={16} color="#ffffff" />
              <text class="settings-btn-text">{token() ? 'Sign in' : 'Browse'}</text>
            </view>
            {currentUser() && (
              <view class="settings-btn settings-btn-secondary" bindtap={signOut}>
                <AppIcon name="logout-box-r-line" size={16} color="#686868" />
                <text class="settings-btn-text-secondary">Sign out</text>
              </view>
            )}
          </view>
          {/* Guard on the leaf field, not the parent object: mastoLogin sets
              the user before verify_credentials fills account in async — a
              mid-transition read here would hit account.acct on undefined. */}
          {currentUser()?.account?.acct && currentUser()?.server
            ? (
                <text class="settings-session">
                  Signed in as @
                  {currentUser()!.account?.acct}
                  @
                  {currentUser()!.server}
                </text>
              )
            : (
                <text class="settings-session">
                  Browsing
                  {currentServer()}
                  {' '}
                  as guest
                </text>
              )}
        </view>

        <text class="settings-section">Interface</text>
        <view class="settings-card">
          <view class="settings-toggle" bindtap={() => setColorMode(settings.colorMode === 'dark' ? 'light' : 'dark')}>
            <text class="settings-toggle-label">Dark mode</text>
            <AppIcon
              name={settings.colorMode === 'dark' ? 'checkbox-circle-line' : 'checkbox-blank-circle-line'}
              size={20}
              color={settings.colorMode === 'dark' ? '#cc7d24' : '#919191'}
            />
          </view>
        </view>

        <text class="settings-section">Timeline preferences</text>
        <view class="settings-card">
          <view class="settings-toggle" bindtap={() => togglePreference('hideBoostsInTimeline')}>
            <text class="settings-toggle-label">Hide boosts in timeline</text>
            <AppIcon
              name={settings.hideBoostsInTimeline ? 'checkbox-circle-line' : 'checkbox-blank-circle-line'}
              size={20}
              color={settings.hideBoostsInTimeline ? '#cc7d24' : '#919191'}
            />
          </view>
          <view class="settings-toggle" bindtap={() => togglePreference('hideRepliesInTimeline')}>
            <text class="settings-toggle-label">Hide replies in timeline</text>
            <AppIcon
              name={settings.hideRepliesInTimeline ? 'checkbox-circle-line' : 'checkbox-blank-circle-line'}
              size={20}
              color={settings.hideRepliesInTimeline ? '#cc7d24' : '#919191'}
            />
          </view>
        </view>

        <text class="settings-section">About</text>
        <view class="settings-card">
          <text class="settings-about">
            Elk on Lynx — a port of the Elk Mastodon client to Vue Lynx.
            Reuses Elk's masto.js API layer, content renderer pipeline and
            domain logic; rebuilds every template on Lynx native elements.
          </text>
        </view>
        <view class="settings-bottom-pad" />
      </scroll-view>
    </view>
  )
}

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})
