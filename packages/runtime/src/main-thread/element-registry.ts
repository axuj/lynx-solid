/**
 * Main Thread element registry: BG-thread ShadowElement id → Lynx element
 * handle. IDs are the contract between the two threads — a mismatch means
 * INSERT/REMOVE hit the wrong element. Stored as a sparse array indexed by
 * id: ids are allocated in contiguous runs (page root, tree expansion,
 * template instance [firstId, firstId + nodeCount)), so direct indexing
 * beats Map hashing on every lookup.
 */

import type { LynxElement } from '../internal/papi.d.ts'

export const elements: (LynxElement | undefined)[] = []

/**
 * Engine-side unique id of the page root (from __GetElementUniqueID).
 * Passed as parentComponentUniqueId to every element creation call.
 */
let pageUniqueId = 1

export function getPageUniqueId(): number {
  return pageUniqueId
}

export function setPageUniqueId(id: number): void {
  pageUniqueId = id
}

/** Reset module state – for testing only / page reload. */
export function resetMainThreadState(): void {
  elements.length = 0
  setPageUniqueId(1)
}
