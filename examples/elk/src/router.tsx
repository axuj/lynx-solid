import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/solid-router'
import { createSignal } from 'solid-js'
import { parseSearch, stringifySearch } from './router-search'
import { routeTree } from './routeTree.gen'

function getInitialPath(): string {
  try {
    return globalThis.__elkGlobalProps?.initialPath || '/'
  }
  catch {
    return '/'
  }
}

// Memory history is required: Lynx has no browser History API.
const history = createMemoryHistory({ initialEntries: [getInitialPath()] })

// The route table is generated from dev/src/elk/routes (file-based routing
// via @tanstack/router-plugin, Generator half only — the CodeSplitter half
// is intentionally excluded to keep Lynx bundles single-file).
const router = createRouter({
  routeTree,
  history,
  // Lynx-side `document` is a shadowed undefined (BG Function params), which
  // the router would otherwise misread as "server environment" and take the
  // SSR path — the same explicit opt-out ReactLynx's TanStack setup uses.
  isServer: false,
  // The router needs an origin to build/parse hrefs. Passing it also keeps
  // `RouterCore` from reading the bare `window?.origin` on the main thread
  // (router-core `router.js:125`: `if (!this.origin) { … window?.origin … }`):
  // on the BG that identifier is a shadowed `RuntimeWrapperWebpackPlugin`
  // parameter, but the IFR main thread has no wrapper, so the bare read is a
  // `ReferenceError: window is not defined` (Lynx error_code 1101) at router
  // construction — module scope, before the first frame.
  origin: 'http://localhost',
  // The router's default search codec (router-core's `qss`) builds a
  // `URLSearchParams`; the main thread has none, and the router is created at
  // module scope, so the IFR main thread died with "ReferenceError:
  // URLSearchParams is not defined" before the first frame. `__MAIN_THREAD__` is
  // a compile-time macro (true only in the main-thread copy), so the
  // background copy keeps TanStack's default codec and never even bundles
  // ours.
  parseSearch: __MAIN_THREAD__ ? parseSearch : undefined,
  stringifySearch: __MAIN_THREAD__ ? stringifySearch : undefined,
})

// Full type safety for useParams/useSearch `from` literals in pages.
// (push()/back() below intentionally bypass the typed navigate() — the
// bridge takes dynamic strings, so it goes through the untyped history API.)
declare module '@tanstack/solid-router' {
  interface Register {
    router: typeof router
  }
}

// ---------------------------------------------------------------------------
// Imperative bridge: existing call sites navigate from `bindtap` handlers via
// bare push()/back()/currentPath() imports, so none of them change.
// ---------------------------------------------------------------------------

const [rawPath, setRawPath] = createSignal(getInitialPath())

history.subscribe(() => {
  const loc = history.location
  setRawPath(loc.pathname + loc.search + loc.hash)
})

export function push(to: string) {
  router.navigate({ to })
}

export function back() {
  router.history.back()
}

export function currentPath() {
  return rawPath()
}

export function ElkRouter() {
  return <RouterProvider router={router} />
}
