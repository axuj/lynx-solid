/**
 * Sign-based event handler registry for the Background Thread.
 *
 * Handlers cannot cross threads, so every bound handler receives a unique
 * sign string ("solid:N"). The sign is shipped to the Main Thread via
 * SET_EVENT; when Native fires the event it calls publishEvent(sign, data)
 * back on the BG Thread, which resolves the sign to the live closure.
 *
 * State lives on globalThis: entry and runtime may end up in separate
 * module graphs (multi-chunk bundles), and a module-level Map would split
 * into two invisible halves.
 */

import { logEvent } from '../internal/ops-log'

type EventHandler = (data: unknown) => void

interface RegistryState {
  signCounter: number
  handlers: Map<string, EventHandler>
}

function getRegistryState(): RegistryState {
  let state = globalThis.__LYNX_SOLID_EVENT_REGISTRY__
  if (!state) {
    state = {
      signCounter: 0,
      handlers: new Map<string, EventHandler>(),
    }
    Object.defineProperty(globalThis, '__LYNX_SOLID_EVENT_REGISTRY__', {
      value: state,
      configurable: true,
      enumerable: false,
      writable: true,
    })
  }
  return state
}

/** Register a handler, returning its immutable sign. */
export function register(handler: EventHandler): string {
  const state = getRegistryState()
  const sign = `solid:${state.signCounter++}`
  state.handlers.set(sign, handler)
  return sign
}

/**
 * Point an existing sign at a fresh handler closure. Re-renders keep the
 * same sign on the Main Thread, so no REMOVE_EVENT/SET_EVENT round-trip.
 */
export function updateHandler(sign: string, handler: EventHandler): void {
  getRegistryState().handlers.set(sign, handler)
}

export function unregister(sign: string): void {
  getRegistryState().handlers.delete(sign)
}

/** Called by Lynx Native when an event fires (sign, data). */
export function publishEvent(sign: string, data: unknown): void {
  const state = getRegistryState()
  const handler = state.handlers.get(sign)
  logEvent(sign, data, handler !== undefined)
  handler?.(data)
}

/**
 * Normalize an event property key to a lynx engine event spec, or null when
 * the key is not an event binding. Lynx event bindings use the bind* /
 * catch* prefixes; DOM-style `on*` names are deliberately NOT translated —
 * a lynx event is not a DOM event (different propagation, different event
 * object), so a DOM-looking name would be misleading. Event names pass
 * through untouched — the engine event names are the lower-case official
 * names (bindtap → "tap", bindscrolltoupper → "scrolltoupper", ...).
 * `catch*` keeps its non-bubbling semantics — folding it into `bindEvent`
 * (as before) silently breaks propagation contracts, so the type must
 * travel the ops untouched to `__AddEvent` (mirrors ReactLynx
 * `eventTypeMap`: bind→bindEvent, catch→catchEvent):
 *   bindtap        → { type: "bindEvent", name: "tap" }
 *   bindscroll     → { type: "bindEvent", name: "scroll" }
 *   catchinput     → { type: "catchEvent", name: "input" }
 */
export function parseEventKey(key: string): { type: string, name: string } | null {
  if (key.startsWith('bind') && key.length > 4)
    return { type: 'bindEvent', name: key.slice(4) }
  if (key.startsWith('catch') && key.length > 5)
    return { type: 'catchEvent', name: key.slice(5) }
  return null
}

/** Reset all state – for testing only. */
export function resetRegistry(): void {
  const state = getRegistryState()
  state.signCounter = 0
  state.handlers.clear()
}
