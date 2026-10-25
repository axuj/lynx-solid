/**
 * renderer: the public entry of the BG-thread runtime.
 *
 * Builds a Solid universal Renderer on top of the ShadowElement tree. Solid
 * executes JSX-ish code against this renderer; node-ops turn every call into
 * (shadow tree mutation + protocol op). The page root is created by us (id=1,
 * no CREATE_PAGE op — the Main Thread already owns it).
 */

import type { Renderer } from '@solidjs/universal'
import type { Element } from 'solid-js'
import { createRenderer } from '@solidjs/universal'
import { createComponent } from 'solid-js'

import { PAGE_ROOT_ID } from '../internal/ops'
import { nodeOps } from './node-ops'
import { createPageRootState, pageRootContext } from './page'
import { ShadowElement } from './shadow-element'

export const renderer: Renderer<ShadowElement> = createRenderer(nodeOps)

/** The one node both threads agree on: the page root, id=1. */
export function createPageRoot(): ShadowElement {
  return new ShadowElement('page', PAGE_ROOT_ID)
}

/**
 * Mount a component tree under the page root and run it to completion of the
 * current reactive flush. Returns a disposer that unmounts everything.
 *
 * `root` is typed with Solid's JSX Element to match customer usage.
 * The internal cast bridges the JSX type domain and the renderer's
 * concrete ShadowElement type. Page root is created internally to hide
 * ShadowElement from the public API (aligns with vue-lynx mount()).
 */
export function render(
  root: () => Element,
): () => void {
  const pageRoot = createPageRoot()
  const state = createPageRootState(pageRoot)
  // Provide the root so compile-rewritten <page> → Page can apply attrs
  // to id=1 without a second native page (vue-lynx Page contract).
  // Solid 2: Context is itself the provider component.
  return renderer.render(
    () => createComponent(pageRootContext, {
      value: state,
      get children() {
        return (root as unknown as () => ShadowElement)()
      },
    }) as unknown as ShadowElement,
    pageRoot,
  )
}
