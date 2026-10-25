import { createMemo, Loading } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import {
  createComponent,
  insert,
  registerTemplate,
} from '../../packages/runtime/src/background/lynx-template'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer } from '../../packages/runtime/src/background/ops-buffer'
import {
  render,
  renderer,
} from '../../packages/runtime/src/background/renderer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { OP } from '../../packages/runtime/src/internal/ops'
import { flushPromises } from '../helpers/async'

/** insert() types its root as a template instance; plain nodes cast through. */
const asRoot = (el: unknown) => el as Parameters<typeof insert>[0]

describe('template instance as render root (compiled call shape)', () => {
  let dispose: (() => void) | undefined

  beforeEach(() => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
  })

  afterEach(() => {
    dispose?.()
    dispose = undefined
  })

  it('INSTANTIATE id run covers the root the page INSERT targets', async () => {
    const received: unknown[][] = []
    setOpsExecutor((ops) => {
      received.push([...ops])
    })

    // compiled shape: _tmpl$() instance is the component root; dynamic
    // content inserts INTO the instance; render() mounts the instance.
    const tmpl = registerTemplate(888273008, { anchors: [], nodeCount: 1 })

    dispose = render(() => {
      const timeline = createMemo(async () => ['a'] as string[])
      const el = tmpl()
      insert(asRoot(el), el, createComponent(Loading, {
        get fallback() {
          const t = renderer.createElement('text')
          insert(asRoot(t), t, 'loading…', null)
          return t
        },
        get children() {
          return (timeline() as string[]).join(',')
        },
      }), null)
      return el
    })

    await flushPromises()

    // Flatten and decode every frame referencing ids
    const frames: string[] = []
    for (const batch of received) {
      let i = 0
      while (i < batch.length) {
        const code = batch[i++] as number
        if (code === OP.INSTANTIATE) {
          frames.push(`INSTANTIATE tpl=${batch[i]} diffs=${JSON.stringify(batch[i + 1])} firstId=${batch[i + 2]}`)
          i += 3
        }
        else if (code === OP.CREATE) {
          frames.push(`CREATE id=${batch[i]} type=${batch[i + 1]}`)
          i += 2
        }
        else if (code === OP.CREATE_TEXT) {
          frames.push(`CREATE_TEXT id=${batch[i]}`)
          i += 1
        }
        else if (code === OP.INSERT) {
          frames.push(`INSERT parent=${batch[i]} child=${batch[i + 1]} anchor=${batch[i + 2]}`)
          i += 3
        }
        else if (code === OP.SET_TEXT) {
          i += 2
        }
        else if (code === OP.SET_CLASS || code === OP.SET_ID) {
          i += 1 + 1
        }
        else {
          break
        }
      }
    }
    // The page-level INSERT must target an id the INSTANTIATE claims.
    const inst = frames.find(f => f.startsWith('INSTANTIATE'))
    expect(inst).toBeTruthy()
    const firstId = Number(inst!.match(/firstId=(\d+)/)![1])
    const pageInsert = frames.filter(f => f.startsWith('INSERT parent=1 '))
    expect(pageInsert.length).toBeGreaterThan(0)
    for (const pi of pageInsert) {
      const child = Number(pi.match(/child=(\d+)/)![1])
      expect(
        child,
        `page INSERT child=${child} outside INSTANTIATE run [${firstId}]`,
      ).toBeGreaterThanOrEqual(firstId)
    }
  })
})
