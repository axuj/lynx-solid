import type { GoProps } from '@lynx-js/go-web'
import { Go as GoBase, GoConfigProvider } from '@lynx-js/go-web'
import { rspressAdapter } from '@lynx-js/go-web/adapters/rspress'
import { useEffect } from 'react'
import '@douyinfe/semi-ui/lib/es/_base/base.css'

const config = {
  exampleBasePath: '/examples',
  defaultTab: 'web' as const,
  // The QR tab says "scan with Lynx Explorer" and links the app name to the
  // install instructions. go-web's built-in default points at lynxjs.org's
  // docs path (`/guide/start/quick-start.html#download-lynx-explorer`), which
  // does not exist on this site — relative to our base it 404s. Both point at
  // the same anchor in this site's quick start, which the copy below adds.
  explorerUrl: {
    en: '/guide/quick-start#download-lynx-explorer',
    cn: '/zh/guide/quick-start#download-lynx-explorer',
  },
  ...rspressAdapter,
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
