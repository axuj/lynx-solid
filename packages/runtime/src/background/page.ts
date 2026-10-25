/**
 * Transparent `<page>` wrapper — port of vue-lynx `Page.ts` / ReactLynx
 * `Page` to Solid.
 *
 * Lynx creates the native page before Background JS runs (`renderPage` →
 * `__CreatePage`, id=PAGE_ROOT_ID). Source `<page>` is rewritten at compile
 * time to this component so the renderer never `createElement('page')`.
 *
 * This component applies the wrapper's attributes to that existing root and
 * returns only its children — no second native page.
 *
 * Exactly one wrapper owns the root at a time. A second concurrent mount
 * reports an error (waiters: the next claimant applies attrs when the owner
 * releases — route swap where incoming mounts before outgoing unmounts).
 */

import type { ShadowElement } from './shadow-element'
import { createContext, createRenderEffect, onSettled, useContext } from 'solid-js'
import { nodeOps } from './node-ops'

export interface PageRootState {
  root: ShadowElement
  owner: symbol | null
  /** Non-owner wrappers waiting to claim the root when the owner releases. */
  waiters: Set<() => void>
}

export const pageRootContext = createContext<PageRootState>()

export function createPageRootState(root: ShadowElement): PageRootState {
  return { root, owner: null, waiters: new Set() }
}

function reportMultiplePages(): void {
  const message = '[lynx-solid] Attempt to render more than one <page>, which is not supported.'
  // Bare `lynx`: on the BG it is a RuntimeWrapperWebpackPlugin parameter and
  // `globalThis.lynx` does not exist (the old global read was always undefined).
  // Guarded because this module also ships to web/test hosts, which have no
  // `lynx`; Reflect because `reportError` is missing from @lynx-js/types.
  const report = typeof lynx === 'undefined' ? undefined : Reflect.get(lynx, 'reportError')
  if (typeof report === 'function')
    report.call(lynx, new Error(message), { level: 'warning' })
  else
    console.error(message)
}

/** Shallow-compare plain style objects so identical rebuilds skip SET_STYLE. */
function shallowEqualStyle(a: unknown, b: unknown): boolean {
  if (a === b)
    return true
  if (
    a == null
    || b == null
    || typeof a !== 'object'
    || typeof b !== 'object'
    || Array.isArray(a)
    || Array.isArray(b)
  ) {
    return false
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length)
    return false
  for (const key of aKeys) {
    if (aObj[key] !== bObj[key])
      return false
  }
  return true
}

/** Props keys that are Solid slots, not Lynx attributes. */
const NON_ATTR_KEYS = new Set(['children', 'ref'])

/**
 * Explicit `<page>` root wrapper. Compile rewrites tag `page` → this.
 * Requires `pageRootContext` from `render()`.
 */
export function Page(props: Record<string, unknown>): unknown {
  const context = useContext(pageRootContext)
  if (!context)
    throw new Error('[lynx-solid] <page> must be rendered inside render().')

  const { root } = context
  const claimant = Symbol('page')
  let owned = false
  let previousAttrs: Record<string, unknown> = {}
  let latestAttrs: Record<string, unknown> = {}

  const applyAttrs = (next: Record<string, unknown>): void => {
    const keys = new Set([
      ...Object.keys(previousAttrs),
      ...Object.keys(next),
    ])
    for (const key of keys) {
      const previous = previousAttrs[key]
      const value = next[key]
      if (previous === value)
        continue
      if (key === 'style' && shallowEqualStyle(previous, value))
        continue
      nodeOps.setProperty(root, key, value)
    }
    previousAttrs = next
  }

  const tryClaim = (): boolean => {
    if (owned)
      return true
    if (context.owner !== null)
      return false
    context.owner = claimant
    owned = true
    return true
  }

  const claimFromWaitlist = (): void => {
    context.waiters.delete(claimFromWaitlist)
    if (tryClaim())
      applyAttrs(latestAttrs)
  }

  const release = (): void => {
    context.waiters.delete(claimFromWaitlist)
    if (!owned)
      return
    applyAttrs({})
    owned = false
    if (context.owner === claimant)
      context.owner = null
    const next = context.waiters.values().next().value
    next?.()
  }

  // Claim synchronously (vue-lynx setup order) so the first render effect
  // already applies attrs; onSettled only wires teardown.
  if (!tryClaim()) {
    reportMultiplePages()
    context.waiters.add(claimFromWaitlist)
  }

  const readAttrs = (): Record<string, unknown> => {
    const next: Record<string, unknown> = {}
    for (const key of Object.keys(props)) {
      if (NON_ATTR_KEYS.has(key))
        continue
      next[key] = props[key]
    }
    return next
  }

  // Initial apply does not wait on the first effect tick (route shells need
  // class/style on the first frame). createRenderEffect tracks later updates.
  if (owned) {
    latestAttrs = readAttrs()
    applyAttrs(latestAttrs)
  }

  onSettled(() => release)

  createRenderEffect(readAttrs, (next) => {
    latestAttrs = next
    if (owned)
      applyAttrs(next)
  })

  return props.children
}
