/**
 * PrimJS (Android BG runtime) API gaps — network-facing surfaces.
 *
 * The stock Lynx toolchain injects polyfills only on iOS; Android PrimJS
 * ships without them for package size. This file fills the gaps that
 * masto.js hits on EVERY request (AbortSignal.any, Headers, URL with base,
 * DOMException) plus ES2022 statics used by the ported Elk code.
 *
 * The API-behavior implementations come from core-js where core-js covers
 * them (Object.hasOwn / Array.at). Never "modernize" hand-written polyfill
 * implementations here — an ESLint autofix once rewrote a hasOwn polyfill
 * to call Object.hasOwn itself, which only explodes on engines lacking the
 * native API; web never noticed.
 *
 * Network plumbing (fetch scope sync + masto pagination wrapper) is ported
 * from the elk example in vue-lynx (https://github.com/Huxpro/vue-lynx,
 * Apache-2.0) — see fetch-compat.ts.
 */
import { installDOMException } from './dom-exception-compat'
import { resolveFetch, wrapFetchForMastoPagination } from './fetch-compat'

import 'core-js/actual/array/at'
import 'core-js/actual/array/flat'
import 'core-js/actual/array/flat-map'
import 'core-js/actual/array/includes'
import 'core-js/actual/object/entries'
import 'core-js/actual/object/from-entries'
import 'core-js/actual/object/has-own'
import 'core-js/actual/object/values'
import 'core-js/actual/string/pad-end'
import 'core-js/actual/string/pad-start'
import 'core-js/actual/string/replace-all'

const g = globalThis as Record<string, any>

// ---------------------------------------------------------------------------
// fetch scope synchronization + masto pagination wrapper
//
// RuntimeWrapperWebpackPlugin injects native fetch as an outer wrapper
// parameter on native, while Lynx for Web exposes it on globalThis.
// Synchronize the callable implementation before masto modules execute so
// their bare `fetch` identifier works in both environments. The pagination
// wrapper normalizes native Headers (Link / Content-Type get dropped by
// native stacks after page one, ending masto Paginators early).
// ---------------------------------------------------------------------------

const sharedFetch = resolveFetch(
  g.fetch,
  typeof fetch === 'function' ? fetch : undefined,
)
if (sharedFetch) {
  const mastoFetch = wrapFetchForMastoPagination(sharedFetch)
  g.fetch = mastoFetch
  // Assigns RuntimeWrapperWebpackPlugin's injected wrapper parameter.
  // @ts-expect-error fetch is declared as a global function in DOM typings.
  // eslint-disable-next-line no-global-assign -- deliberate scope sync
  fetch = mastoFetch as typeof fetch
}

installDOMException(g)

// ---------------------------------------------------------------------------
// scrollTo — viewport scroll reset for @tanstack/solid-router navigations.
// The router calls the bare `scrollTo` global after every committed location
// (including the initial load). Lynx has no DOM viewport, so a no-op. This
// name is NOT among the Lynx BG Function params (unlike document/window),
// so the globalThis install below is visible to bundle code.
// ---------------------------------------------------------------------------

if (typeof globalThis.scrollTo !== 'function')
  globalThis.scrollTo = () => {}

// ---------------------------------------------------------------------------
// self — worker-scope alias for TanStack's devtools hook.
// The router constructor tags the instance via bare `self.__TSR_ROUTER__`.
// Unlike scrollTo above, `self` IS among RuntimeWrapperWebpackPlugin's
// wrapper params (defaultInjectVars), so on device the bare binding resolves
// to that (undefined) parameter and a globalThis install alone stays
// invisible to bundle code. Sync the wrapper-scope binding itself, mirroring
// the fetch scope sync above.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-restricted-globals -- deliberate wrapper-scope read (see below)
if (typeof self === 'undefined') {
  // `__lynxSolidMountIfrRoot` is installed by `main-thread/ifr-runtime`, which the
  // plugin injects into the MT entry only under `enableMtIfr` (and before user
  // code). Its presence is therefore the MT-IFR marker — the one thread where
  // app code runs without the RuntimeWrapperWebpackPlugin parameters.
  if (!('__lynxSolidMountIfrRoot' in globalThis)) {
    // BG: `self` is a wrapper parameter (undefined), so the bare binding is the
    // one bundle code reads — sync it.
    // @ts-expect-error device has no Window: `self` is DOM-typed but assigned the bare global scope
    // eslint-disable-next-line no-global-assign, no-restricted-globals -- deliberate scope sync (see fetch above)
    self = globalThis
  }
  // MT-IFR: the bare binding does not exist at all, and a strict-mode module
  // throws `ReferenceError: self is not defined` on assignment — before the
  // first screen can paint. The `globalThis.self` install below is what MT
  // bundle code resolves, so nothing else is needed here.
}
if (typeof globalThis.self === 'undefined')
  g.self = globalThis

// ---------------------------------------------------------------------------
// AbortController / AbortSignal
// ---------------------------------------------------------------------------

if (typeof g.AbortSignal !== 'function' || typeof g.AbortSignal.any !== 'function') {
  type Listener = () => void

  class LynxAbortSignal {
    aborted = false
    reason: unknown
    onabort: Listener | null = null
    private listeners: Listener[] = []

    addEventListener(type: string, fn: Listener) {
      if (type === 'abort')
        this.listeners.push(fn)
    }

    removeEventListener(type: string, fn: Listener) {
      this.listeners = this.listeners.filter(l => l !== fn)
    }

    throwIfAborted() {
      if (this.aborted)
        throw this.reason
    }

    /** @internal */
    _abort(reason?: unknown) {
      if (this.aborted)
        return
      this.aborted = true
      this.reason = reason ?? new Error('The operation was aborted.')
      this.onabort?.()
      for (const fn of this.listeners) fn()
    }

    static abort(reason?: unknown) {
      const signal = new LynxAbortSignal()
      signal._abort(reason)
      return signal
    }

    static timeout(ms: number) {
      const signal = new LynxAbortSignal()
      setTimeout(() => signal._abort(new Error('TimeoutError')), ms)
      return signal
    }

    static any(signals: LynxAbortSignal[]) {
      // Spec deviation: masto calls AbortSignal.any(signals) on every
      // request even when `signals` is empty. Returning undefined keeps
      // polyfill signal objects out of the native fetch's RequestInit,
      // whose signal handling is an unknown quantity.
      if (!signals || signals.length === 0)
        return undefined as unknown as LynxAbortSignal
      const combined = new LynxAbortSignal()
      for (const signal of signals) {
        if (signal.aborted) {
          combined._abort(signal.reason)
          break
        }
        signal.addEventListener?.('abort', () => combined._abort(signal.reason))
      }
      return combined
    }
  }

  class LynxAbortController {
    signal = new LynxAbortSignal()
    abort(reason?: unknown) {
      this.signal._abort(reason)
    }
  }

  g.AbortSignal = LynxAbortSignal
  g.AbortController = LynxAbortController
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

if (typeof g.Headers !== 'function') {
  type HeadersInitLike
    = | Array<[string, string]>
      | Record<string, string>
      | { entries: () => IterableIterator<[string, string]> }
      | undefined

  class LynxHeaders {
    private map = new Map<string, string>()

    constructor(init?: HeadersInitLike) {
      if (!init)
        return
      if (Array.isArray(init)) {
        for (const [k, v] of init) this.append(k, v)
      }
      else if (typeof (init as any).entries === 'function') {
        for (const [k, v] of (init as any).entries()) this.append(k, v)
      }
      else {
        for (const [k, v] of Object.entries(init)) this.append(k, String(v))
      }
    }

    get(name: string) {
      return this.map.get(name.toLowerCase()) ?? null
    }

    set(name: string, value: string) {
      this.map.set(name.toLowerCase(), String(value))
    }

    append(name: string, value: string) {
      const key = name.toLowerCase()
      const existing = this.map.get(key)
      this.map.set(key, existing ? `${existing}, ${value}` : String(value))
    }

    has(name: string) {
      return this.map.has(name.toLowerCase())
    }

    delete(name: string) {
      this.map.delete(name.toLowerCase())
    }

    forEach(fn: (value: string, key: string, headers: LynxHeaders) => void) {
      for (const [k, v] of this.map) fn(v, k, this)
    }
  }

  g.Headers = LynxHeaders
}

// ---------------------------------------------------------------------------
// URLSearchParams — the subset the router's query-string codec and masto use:
//   new URLSearchParams(str), .set/.get/.has/.delete/.append, iteration,
//   .toString().
//
// The background thread has it natively (PrimJS) and keeps it: this installs
// ONLY when missing, so the native implementation is never replaced. The
// IFR main thread has none, and TanStack Router's query-string codec needs it
// while the router renders the first screen there — without this the main
// thread dies with "ReferenceError: URLSearchParams is not defined" and the
// first screen is blank.
//
// Ported from the URLSearchParams polyfill in the elk example of vue-lynx
// (https://github.com/Huxpro/vue-lynx, Apache-2.0) — the same example app the
// rest of this polyfill set comes from. Never "modernize" it by hand: an ESLint
// autofix once rewrote a hand-written hasOwn polyfill to call Object.hasOwn
// itself, which only explodes on engines lacking the native API.
// ---------------------------------------------------------------------------

if (typeof g.URLSearchParams !== 'function') {
  class LynxURLSearchParams {
    private pairs: Array<[string, string]> = []

    constructor(init?: string | Record<string, string> | Array<[string, string]>) {
      if (!init)
        return
      if (typeof init === 'string') {
        const raw = init.startsWith('?') ? init.slice(1) : init
        for (const part of raw.split('&')) {
          if (!part)
            continue
          const [k, ...rest] = part.split('=')
          this.pairs.push([decodeURIComponent(k), decodeURIComponent(rest.join('=') ?? '')])
        }
      }
      else if (Array.isArray(init)) {
        this.pairs = init.map(([k, v]) => [String(k), String(v)])
      }
      else {
        this.pairs = Object.entries(init).map(([k, v]) => [k, String(v)])
      }
    }

    get(name: string) {
      const hit = this.pairs.find(([k]) => k === name)
      return hit ? hit[1] : null
    }

    getAll(name: string) {
      return this.pairs.filter(([k]) => k === name).map(([, v]) => v)
    }

    set(name: string, value: string) {
      this.delete(name)
      this.pairs.push([name, String(value)])
    }

    append(name: string, value: string) {
      this.pairs.push([name, String(value)])
    }

    has(name: string) {
      return this.pairs.some(([k]) => k === name)
    }

    delete(name: string) {
      this.pairs = this.pairs.filter(([k]) => k !== name)
    }

    forEach(fn: (value: string, key: string) => void) {
      for (const [k, v] of this.pairs) fn(v, k)
    }

    * entries(): IterableIterator<[string, string]> {
      yield* this.pairs
    }

    [Symbol.iterator]() {
      return this.entries()
    }

    toString() {
      return this.pairs
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    }
  }

  g.URLSearchParams = LynxURLSearchParams
}

// ---------------------------------------------------------------------------
// URL with base — the subset masto.js uses:
//   new URL(absolute), new URL(path, base), url.search = 'a=b', String(url)
// Replaced only when the native URL fails the compatibility probe.
// ---------------------------------------------------------------------------

function hasCompatibleURL(URLCtor: unknown): boolean {
  if (typeof URLCtor !== 'function')
    return false
  try {
    const url = new (URLCtor as typeof URL)('https://example.com/path?a=1')
    if (url.pathname !== '/path' || url.search !== '?a=1')
      return false
    url.searchParams.set('b', '2')
    return url.pathname === '/path'
      && url.search.includes('a=1')
      && url.search.includes('b=2')
  }
  catch {
    return false
  }
}

if (!hasCompatibleURL(g.URL)) {
  // eslint-disable-next-line regexp/no-super-linear-backtracking -- verbatim from vue-lynx upstream; input is engine-constructed URLs, not user text
  const ABSOLUTE_RE = /^([a-z][\w+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i

  class LynxURL {
    protocol = ''
    host = ''
    pathname = ''
    private _search = ''
    hash = ''

    constructor(input: string | LynxURL, base?: string | LynxURL) {
      const url = String(input)
      const match = url.match(ABSOLUTE_RE)
      if (match) {
        this.protocol = `${match[1].toLowerCase()}:`
        this.host = match[2]
        this.pathname = match[3] || '/'
        this._search = match[4] ?? ''
        this.hash = match[5] ?? ''
        return
      }

      if (base === undefined)
        throw new TypeError(`Invalid URL: ${url}`)
      const parsedBase = base instanceof LynxURL ? base : new LynxURL(String(base))
      this.protocol = parsedBase.protocol
      this.host = parsedBase.host

      const [beforeHash, ...hashParts] = url.split('#')
      this.hash = hashParts.length ? `#${hashParts.join('#')}` : ''
      const [path, ...queryParts] = beforeHash.split('?')
      this._search = queryParts.length ? `?${queryParts.join('?')}` : ''

      if (path.startsWith('/')) {
        this.pathname = path
      }
      else if (path === '') {
        this.pathname = parsedBase.pathname
        if (!queryParts.length)
          this._search = parsedBase.search
      }
      else {
        // resolve against the base directory
        const dir = parsedBase.pathname.replace(/[^/]*$/, '')
        this.pathname = dir + path
      }
    }

    get search() {
      return this._search
    }

    set search(value: string) {
      const v = String(value ?? '')
      this._search = v && !v.startsWith('?') ? `?${v}` : v
    }

    get searchParams() {
      const params = new (g.URLSearchParams)(this._search)
      const sync = () => {
        const query = params.toString()
        this._search = query ? `?${query}` : ''
      }
      for (const method of ['set', 'append', 'delete'] as const) {
        const original = params[method].bind(params)
        params[method] = ((...args: unknown[]) => {
          original(...args)
          sync()
        }) as never
      }
      return params
    }

    get origin() {
      return `${this.protocol}//${this.host}`
    }

    toString() {
      return this.href
    }

    toJSON() {
      return this.href
    }

    /**
     * Non-standard: native Request implementations may duck-type
     * non-string inputs as Request-like objects and read `.url`.
     */
    get href() {
      return `${this.origin}${this.pathname}${this._search}${this.hash}`
    }

    get url() {
      return this.href
    }
  }

  g.URL = LynxURL
}
