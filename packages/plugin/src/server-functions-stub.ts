/**
 * Stand-in for `@solidjs/web/server-functions` on Lynx.
 *
 * Why this exists: `@solidjs/web` rc.18 evaluates
 * `new TextEncoder().encode(':\n\n')` at module scope of its server-function
 * client (a server-only SSE heartbeat constant that was never meant to reach
 * a client bundle), and `@tanstack/solid-router` imports that module
 * statically from `flightData.ts` — which `RouterProvider` pulls in
 * unconditionally on the client. Neither PrimJS (BG) nor Lepus (MT) ships
 * `TextEncoder`, so the import dies before the first frame.
 *
 * Lynx has no server-function runtime at all, so the fix is to keep the module
 * out of the graph rather than to fill the host gap: `pluginSolidLynx` aliases
 * `@solidjs/web/server-functions` here for the lynx environments (the web
 * preview keeps the real module — a browser has `TextEncoder` natively).
 *
 * Only what the router actually imports is exported, each inert:
 *   - `REDIRECT_HEADER` — the header a server-function response would carry.
 *     Nothing on Lynx ever sets it, so reads keep returning null and the
 *     router's `applyResponseMetadata` bails at its first guard.
 *   - `decodeRedirectHeaderValue` — never reached; `undefined` matches what a
 *     missing header decodes to.
 *   - `subscribeFlightData` — called by the router on mount. MUST return an
 *     unsubscribe function: `RouterProvider` passes the result straight to
 *     `onCleanup()`.
 *
 * Self-expiring: `tests/behavior/upstream-leak.test.ts` fails once upstream
 * stops evaluating `TextEncoder` at import time, which is the signal to delete
 * this file and the alias.
 */

export const REDIRECT_HEADER = 'X-Server-Function-Redirect'

export const REVALIDATE_HEADER = 'X-Revalidate'

export function decodeRedirectHeaderValue(): undefined {
  return undefined
}

export function subscribeFlightData(): () => void {
  return () => {}
}
