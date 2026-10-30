/**
 * Fires an action from an event handler and owns the rejection.
 *
 * An action's promise rejects when the request fails. By the time it does the
 * optimistic layer has already rewound on its own, so the rejection is not
 * something the UI has to recover from — it just needs a handler, or it
 * surfaces as an unhandled rejection.
 */
export function runAction(p: Promise<unknown> | void): void {
  void Promise.resolve(p).catch(() => {
    // Already rolled back — nothing left to do.
  })
}
