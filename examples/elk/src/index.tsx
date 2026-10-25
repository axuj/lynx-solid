import { render } from '@lynx-solid/runtime'

// Fill-if-missing web API polyfills for the native Lynx runtime (masto.js
// needs fetch scope sync / AbortSignal / Headers / URL-with-base before any
// request). No URLSearchParams polyfill: TanStack ships its own query parser
// (bundled qss) and masto.js only uses URL/.search — PrimJS needs nothing here.
import './polyfills'

import { App } from './App'
import { mastoLogin } from './composables/masto'
import { DEFAULT_SERVER } from './composables/users'

import './elk.css'

// Anonymous session against the default public instance — Elk's guest mode.
// Sign in from Settings (server + access token) for home/notifications/votes.
mastoLogin({ server: DEFAULT_SERVER })

render(() => <App />)
