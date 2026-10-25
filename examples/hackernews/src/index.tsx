import { render } from '@lynx-solid/runtime'

// Fill-if-missing web API polyfills for the native Lynx runtime: scrollTo
// no-op (TanStack calls it after every navigation), self alias (router
// devtools hook), URL with base (utils.toHost). HackerNews hits plain JSON
// APIs so it needs none of elk's masto-specific machinery.
import './polyfills'

import { HackerNewsRouter } from './router'

import './hackernews.css'

render(() => <HackerNewsRouter />)
