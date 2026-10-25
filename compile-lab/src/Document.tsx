import type { ParentProps } from 'solid-js'
import { HydrationScript } from '@solidjs/web'

// The document shell — the new index.html: picked up by the src/Document.*
// convention, it wraps the app in the plugin's generated entries and must
// render the full <html>. Head tags go here. It is compiled only into the
// prerendered static shell and ships zero client-side JS: in client mode
// <HydrationScript /> is stripped from the shell, and it activates when the
// app flips to SSR (`ssr: true` in vite.config.ts) — no document changes
// needed. Delete this file to fall back to the plugin's built-in shell.
export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23f97316'/%3E%3Ctext x='8' y='12' font-size='10' text-anchor='middle' fill='white'%3EL%3C/text%3E%3C/svg%3E" />
        <title>compile-lab</title>
        {/* The real Lynx web host: registers <lynx-view> and loads the
            web-core runtime (MT iframe + BG worker). Static module scripts
            defer to after parse, so the element is defined before the app
            body creates it. */}
        <link rel="stylesheet" href="/static/css/client.css" />
        <script type="module" src="/static/js/client.js" />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  )
}
