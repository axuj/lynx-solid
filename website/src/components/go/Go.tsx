import type { GoProps } from '@lynx-js/go-web'
import { Go as GoBase, GoConfigProvider } from '@lynx-js/go-web'
import { rspressAdapter } from '@lynx-js/go-web/adapters/rspress'
import { useEffect } from 'react'
import '@douyinfe/semi-ui/lib/es/_base/base.css'

// Install instructions live on the official docs (same anchor go-web's own
// default points at) — we do not mirror release asset names or store links.
// Absolute URLs so the QR tab sends readers to lynxjs.org, not back here.
const EXPLORER_URL = {
  en: 'https://lynxjs.org/guide/start/quick-start.html#download-lynx-explorer,ios-simulator-platform=macos-arm64,explorer-platform=ios-simulator',
  cn: 'https://lynxjs.org/zh/guide/start/quick-start.html#download-lynx-explorer,ios-simulator-platform=macos-arm64,explorer-platform=ios-simulator',
}

const config = {
  exampleBasePath: '/examples',
  defaultTab: 'web' as const,
  explorerUrl: EXPLORER_URL,
  ...rspressAdapter,
  // rspress' withBase is `addLeadingSlash` + site base, so it would rewrite an
  // absolute URL into `/<base>/https://…`. Keep external links untouched and
  // only prefix site-relative paths.
  withBase: (url: string) =>
    /^https?:\/\//.test(url) ? url : rspressAdapter.withBase!(url),
}

/**
 * Sync Rspress dark mode → Semi UI body attribute.
 *
 * Go only reads the theme: its chrome consumes `var(--semi-*)` tokens whose
 * dark values live under `body[theme-mode="dark"]` (semi.min.css above),
 * while Rspress toggles `dark` on `<html>`. Without this bridge the embeds
 * stay light. Same pattern as go-web's official rspress example.
 */
function useSemiDarkMode(): void {
  const dark = rspressAdapter.useDark!()
  useEffect(() => {
    document.body.setAttribute('theme-mode', dark ? 'dark' : 'light')
  }, [dark])
}

// What the QR code encodes. `?fullscreen=true` tells LynxExplorer to open the
// bundle edge-to-edge instead of inside its navigation chrome — every example
// here is a full-screen app, so that is the right default. Pages that need
// more (elk passes bar/bg colours) override it with their own `schema`.
const QRCODE_SCHEMA = '{{{url}}}?fullscreen=true'

export function Go(props: GoProps) {
  useSemiDarkMode()
  return (
    <GoConfigProvider config={config}>
      <GoBase schema={QRCODE_SCHEMA} {...props} />
    </GoConfigProvider>
  )
}

export type { GoProps }
export default Go
