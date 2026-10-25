/**
 * Typed element creation dispatch.
 *
 * The engine's generic __CreateElement maps `scroll-view` to
 * `x-scroll-view` (LYNX_TAG_TO_HTML_TAG_MAP) — an element web-elements never
 * registers, so it gets no scroll-view styles and cannot scroll. Native Lynx
 * provides typed creators (__CreateView, __CreateText, __CreateImage,
 * __CreateScrollView) that build the real elements.
 *
 * Same strategy as vue-lynx (TYPED_CREATE in
 * plugin/src/compiler/element-template-transform.ts) and ReactLynx (create
 * match in transform/crates/swc_plugin_snapshot): known types use their
 * typed creator at every call site, unknown types fall back to
 * __CreateElement. No global is replaced — both element-creation entry
 * points (ops-apply CREATE branch and template skeleton
 * P.create) route through createElementByType.
 *
 * If the engine ever grows typed template dispatch, this module can be
 * deleted wholesale.
 */

import type { LynxElement } from '../internal/papi.d.ts'
import { getPageUniqueId } from './element-registry'
import { createListElement } from './list-apply'

type ElementCreator = (parentComponentUniqueId: number) => LynxElement

const TYPED_CREATE: Record<string, ElementCreator> = {
  'view': parentId => __CreateView(parentId),
  'text': parentId => __CreateText(parentId),
  'image': parentId => __CreateImage(parentId),
  'scroll-view': parentId => __CreateScrollView(parentId),
}

/** Create an element via its typed creator when one exists. */
export function createElementTyped(
  type: string,
  parentComponentUniqueId: number,
): LynxElement {
  const typed = TYPED_CREATE[type]
  return typed !== undefined
    ? typed(parentComponentUniqueId)
    : __CreateElement(type, parentComponentUniqueId)
}

/**
 * Single high-level type dispatch for both element-creation entry points
 * (applyOps CREATE branch and template skeleton P.create). Lists must go
 * through createListElement (__CreateList with componentAtIndex callbacks) —
 * a plain __CreateElement('list') leaves the native element without
 * callbacks, so the first item request crashes the engine.
 */
export function createElementByType(type: string, id: number): LynxElement {
  return type === 'list'
    ? createListElement(id)
    : createElementTyped(type, getPageUniqueId())
}
