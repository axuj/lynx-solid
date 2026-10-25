/**
 * Theme chrome ported from lynx-examples `shared/ThemeFrame` (Apache-2.0).
 * Differences vs the React original: no `useGlobalProps` (Solid runtime
 * has none) — theme defaults to `lunaris-light` unless passed explicitly.
 * `JSX.Element` resolves from the global namespace (jsx-runtime merge).
 */
import './theme-frame.css'

export function ThemeFrame(props: {
  children?: JSX.Element
  theme?: 'auto' | 'luna-light' | 'lunaris-light' | 'luna-dark' | 'lunaris-dark'
}): JSX.Element {
  const themeClass = (): string => {
    const t = props.theme
    if (t && t !== 'auto')
      return t
    return 'lunaris-light'
  }

  return (
    <view class={`theme-frame ${themeClass()}`}>
      <view class="theme-content">{props.children}</view>
    </view>
  )
}
