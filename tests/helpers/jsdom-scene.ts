/**
 * Ported-scene runner: compile a scene through the fork pipeline
 * (compileDomModule), boot the MT against a jsdom container (renderPage),
 * execute the BG module, apply all ops and expose a `settle()` for reactive
 * updates — the loop behind the official solid-web test ports.
 */

import type { JsdomPapiHost } from './jsdom-papi'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { pathToFileURL } from 'node:url'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'
import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetLynxTemplateState } from '../../packages/runtime/src/background/lynx-template'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { OP } from '../../packages/runtime/src/internal/ops'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { registerSkeleton } from '../../packages/runtime/src/main-thread/skeleton-registry'
import { flushPromises } from './async'
import { mountJsdomPapi } from './jsdom-papi'
import '../../packages/runtime/src/main-thread/index'

let counter = 0

export interface SceneHandle {
  /** The jsdom tree under the mount container (page root). */
  host: JsdomPapiHost
  /** Flush pending BG batches through the MT (call after triggering signals). */
  settle: () => Promise<void>
  /** Ops batches still pending application. */
  pendingCount: () => number
  /** Snapshot of the pending ops batches (debugging). */
  debugOps: () => unknown[][]
}

/**
 * Compile + boot + execute a fork-compiled scene against `container`.
 * The container becomes the page root; after this resolves, its children
 * hold the rendered component tree (DOM semantics for assertions).
 */
export async function runScene(src: string, container: HTMLElement): Promise<SceneHandle> {
  const scene = compileDomModule(src)
  resetOpsBuffer()
  resetFlushState()
  resetShadowState()
  resetRegistry()
  resetNodeOpsState()
  resetLynxTemplateState()
  resetApplyOpsState()

  const host = mountJsdomPapi(container)
  globalThis.renderPage?.()

  for (const t of scene.templates) {
    // eslint-disable-next-line no-eval
    registerSkeleton(t.id, eval(`(${t.createCode})`))
  }

  const pending: unknown[][] = []
  setOpsExecutor(ops => pending.push(ops))

  const file = join(process.cwd(), 'tests', `tmp-port-${counter++}-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(
    file,
    scene.code
      .replaceAll(
        '@lynx-solid/runtime/lynx-template',
        pathToFileURL(join(process.cwd(), 'packages/runtime/src/background/lynx-template.ts')).href,
      )
      .replaceAll('@lynx-solid/runtime', pathToFileURL(join(process.cwd(), 'packages/runtime/src/index.ts')).href),
  )
  try {
    await import(pathToFileURL(file).href)
    await flushPromises()
  }
  finally {
    rmSync(file, { force: true })
  }

  for (const batch of pending.splice(0))
    applyOps(batch)

  return {
    host,
    pendingCount: () => pending.length,
    debugOps: () => pending.map(b => [...b]),
    async settle(): Promise<void> {
      await flushPromises()
      for (const batch of pending.splice(0))
        applyOps(batch)
    },
  }
}

export { OP }
