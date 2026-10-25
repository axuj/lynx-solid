import { createStore } from 'solid-js'

export interface UserSettings {
  hideBoostsInTimeline: boolean
  hideRepliesInTimeline: boolean
  fontSize: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  colorMode: 'light' | 'dark'
  zenMode: boolean
}

const [settings, setSettings] = createStore<UserSettings>({
  hideBoostsInTimeline: false,
  hideRepliesInTimeline: false,
  fontSize: 'md',
  colorMode: 'light',
  zenMode: false,
})

export function useUserSettings() {
  return settings
}

export function getPreferences<K extends keyof UserSettings>(s: UserSettings, key: K): UserSettings[K] {
  return s[key]
}

export function togglePreference(key: 'hideBoostsInTimeline' | 'hideRepliesInTimeline') {
  // Use draft mode to preserve fine-grained updates
  setSettings((s) => {
    s[key] = !s[key]
  })
}

export function setColorMode(mode: 'light' | 'dark') {
  setSettings((s) => {
    s.colorMode = mode
  })
}

export function toggleZenMode() {
  setSettings((s) => {
    s.zenMode = !s.zenMode
  })
}
