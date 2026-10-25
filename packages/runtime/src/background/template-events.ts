/**
 * Events registered through template id-based bindings (lynx-template's
 * setAttribute/addEventListener emit SET_EVENT by raw id — there is no
 * shadow node for the static cell, so removeNode's elementEventSigns walk
 * never sees them).
 *
 * Un-shipped REMOVE_EVENT leaves the cell pinned in the engine's listener
 * registry, which keeps the detached row subtree reachable after the app has
 * dropped it (the web host additionally retains it through DOM parent links).
 * Track here so the batch-scoped teardown (batch-teardown.ts) can ship
 * REMOVE_EVENT + unregister the BG sign at drain, cancelled when a same-batch
 * move re-claims the ids.
 */

import { unregister } from './event-registry'

export interface TrackedTemplateEvent {
  type: string
  name: string
  sign?: string
}

const templateEvents = new Map<number, TrackedTemplateEvent>()

/** Called at SET_EVENT emission for a template-internal id. */
export function trackTemplateEvent(id: number, ev: TrackedTemplateEvent): void {
  // Rebind: a fresh sign supersedes the stored one — release the old
  // closure now or it leaks in the registry for the session (death only
  // ever reclaims the latest entry).
  const prev = templateEvents.get(id)
  if (prev?.sign && prev.sign !== ev.sign)
    unregister(prev.sign)
  templateEvents.set(id, ev)
}

/** Collect + forget every tracked event among `ids` (dying id ranges). */
export function takeTemplateEvents(ids: Iterable<number>): Array<{ id: number } & TrackedTemplateEvent> {
  const out: Array<{ id: number } & TrackedTemplateEvent> = []
  for (const id of ids) {
    const ev = templateEvents.get(id)
    if (ev) {
      out.push({ id, ...ev })
      templateEvents.delete(id)
    }
  }
  return out
}

/** Reset module state – for testing only. */
export function resetTemplateEvents(): void {
  templateEvents.clear()
}
