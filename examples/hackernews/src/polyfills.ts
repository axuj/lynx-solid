/**
 * PrimJS (Android BG runtime) API gaps — the subset HackerNews needs.
 * Masto-specific plumbing from elk is skipped here: the demo talks to plain
 * JSON APIs (api.hackerwebapp.com / firebaseio), so no Headers/
 * fetch-scope-sync wrappers are required. `AbortSignal` is required after
 * all — but by the router rather than by an HTTP client, and only on the IFR
 * main thread (see the section below).
 *
 * Covered:
 *  - `scrollTo` no-op — @tanstack/solid-router calls the bare global after
 *    every committed location (including initial load). Lynx has no DOM
 *    viewport. Not among Lynx BG Function params, so globalThis install works.
 *  - `self` alias — TanStack's devtools hook tags the router through the bare
 *    `self`. Unlike scrollTo, `self` IS among RuntimeWrapperWebpackPlugin's
 *    params; sync the wrapper-scope binding too, mirroring elk's polyfills.
 *  - `URL` with base — native URL may be absent/incomplete on PrimJS; the
 *    compatibility probe swaps in a minimal LynxURL when needed.
 *  - `URLSearchParams` — installed only when missing (the BG has it natively),
 *    because the IFR main thread has none and the router's query-string codec
 *    needs one while it renders the first screen there.
 *  - `AbortController` / `AbortSignal` — IFR main thread only; the router news
 *    one up while it matches the first route there.
 */
import 'core-js/actual/array/includes'
import 'core-js/actual/object/entries'
import 'core-js/actual/string/replace-all'

// ---------------------------------------------------------------------------
// scrollTo — viewport scroll reset for router navigations.
// ---------------------------------------------------------------------------

if (typeof globalThis.scrollTo !== 'function')
  globalThis.scrollTo = () => {}

// ---------------------------------------------------------------------------
// self — worker-scope alias for TanStack's devtools hook.
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
    // eslint-disable-next-line no-global-assign, no-restricted-globals -- deliberate scope sync (see elk polyfills)
    self = globalThis
  }
  // MT-IFR: the bare binding does not exist at all, and a strict-mode module
  // throws `ReferenceError: self is not defined` on assignment — before the
  // first screen can paint. The `globalThis.self` install below is what MT
  // bundle code resolves, so nothing else is needed here.
}
if (typeof globalThis.self === 'undefined')
  // as: host global container, no Window type surface (globalThis lacks DOM Window members such as name) — no narrowing possible
  (globalThis as Record<string, unknown>).self = globalThis

const g = globalThis as Record<string, any> // as: host global container, globalThis.URL may be absent from the type surface

// ---------------------------------------------------------------------------
// URLSearchParams — the subset the router's query-string codec uses:
//   new URLSearchParams(str), .set/.get/.has/.delete/.append, iteration,
//   .toString().
//
// Installed ONLY when missing, so the background thread keeps its native
// implementation (PrimJS has one); the IFR main thread has none, and the
// router's codec needs one while it renders the first screen there — without
// this the main thread dies with "ReferenceError: URLSearchParams is not
// defined" and the first screen is blank.
//
// Ported from the URLSearchParams polyfill in the elk example of vue-lynx
// (https://github.com/Huxpro/vue-lynx, Apache-2.0). Never "modernize" it by
// hand: an ESLint autofix once rewrote a hand-written hasOwn polyfill to call
// Object.hasOwn itself, which only explodes on engines lacking the native API.
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
// AbortController / AbortSignal — IFR main thread only.
//
// @tanstack/solid-router 2.0.0-rc.9 (router-core 1.171.x) news up an
// AbortController inside `matchRoutesInternal`:
//   router.js — `abortController: opts?._controller ?? new AbortController()`
// rc.6, the version this file was written against, never touched it. The IFR
// main thread runs that match while it renders the first screen and has no
// AbortController at all, so it dies with
// `ReferenceError: AbortController is not defined` (Lynx error_code 1101) and
// the first screen never comes from the main thread.
//
// Scoped to the main-thread copy on purpose: the background thread is not the
// one throwing, and nothing here should shadow an implementation it does have.
// `__MAIN_THREAD__` is a built-in compile-time macro (per copy: true in the MT
// copy, false in the BG one), so the background bundle folds this whole block
// away — and in a non-IFR build the MT copy of this module is an import shell
// whose body never executes, so the block can only ever run under MT-IFR.
// Only the members router-core reads are implemented — `aborted`, `reason`,
// `add`/`removeEventListener('abort')` and `throwIfAborted()` (see its
// await-signal.js / load-client.js); unlike elk's copy, `AbortSignal.any` is
// left out because no caller here needs it.
// ---------------------------------------------------------------------------

if (__MAIN_THREAD__ && typeof g.AbortController !== 'function') {
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
// URL with base — minimal LynxURL when the native constructor fails the probe.
// (toHost does not use URL — vue-lynx HN slices the host from the string.)
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
        }) as never // as: host has no type surface — URLSearchParams method signatures are missing from the Lynx types
      }
      return params
    }

    get origin() {
      return `${this.protocol}//${this.host}`
    }

    get href() {
      return `${this.origin}${this.pathname}${this._search}${this.hash}`
    }

    toString() {
      return this.href
    }

    toJSON() {
      return this.href
    }
  }

  g.URL = LynxURL
}
