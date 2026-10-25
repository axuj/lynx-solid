/**
 * Repro: elk tap-to-reveal — tapping the sensitive mask must unblur the
 * image (filter blur(30px) → blur(0px)) and remove the mask overlay.
 * Inlines the StatusMedia UI shape (TEMP all-gated variant) and drives the
 * tap through publishEvent, covering the full BG→ops→MT pipeline in-process.
 */
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'
import { publishEvent, resetRegistry } from '../../packages/runtime/src/background/event-registry'
import { resetFlushState, setOpsExecutor } from '../../packages/runtime/src/background/flush'
import { resetLynxTemplateState } from '../../packages/runtime/src/background/lynx-template'
import { resetMainThreadRefState } from '../../packages/runtime/src/background/main-thread-ref'
import { resetNodeOpsState } from '../../packages/runtime/src/background/node-ops'
import { resetOpsBuffer, takeOps } from '../../packages/runtime/src/background/ops-buffer'
import { resetShadowState } from '../../packages/runtime/src/background/shadow-element'
import { iterOps, OP } from '../../packages/runtime/src/internal/ops'
import { applyOps, resetApplyOpsState } from '../../packages/runtime/src/main-thread/ops-apply'
import { registerSkeleton } from '../../packages/runtime/src/main-thread/skeleton-registry'
import { flushPromises } from '../helpers/async'
import { installFakePapi } from '../helpers/fake-papi'
import '../../packages/runtime/src/main-thread/index'

const g = globalThis as Record<string, unknown>

const SRC = `
import { render } from '@lynx-solid/runtime'
import { For, createMemo, createSignal } from 'solid-js'

function openMediaPreview(_att: unknown): void {
  ;(globalThis as any).__previewOpened = true
}

const attachments = [
  { type: 'image', url: 'https://x/y.jpg', previewUrl: 'https://x/y-preview.jpg', meta: { original: { aspect: 1.5 } } },
]

function StatusMedia() {
  const [revealed, setRevealed] = createSignal(false)
  const hidden = createMemo(() => !revealed())
  function onTapAttachment(att: any) {
    if (hidden()) {
      setRevealed(true)
      return
    }
    openMediaPreview(att)
  }
  function attachmentSrc(att: any): string {
    return att.previewUrl || att.url || ''
  }
  return (
    <view class="status-media">
      <For each={attachments}>
        {(att: any) => (
          attachmentSrc(att)
            ? (
                <view class="status-media-item" bindtap={() => onTapAttachment(att)}>
                  <image
                    src={attachmentSrc(att)}
                    class="status-media-img"
                    style={{
                      aspectRatio: String(att.meta?.original?.aspect || 1.618),
                      filter: hidden() ? 'blur(30px)' : 'blur(0px)',
                    }}
                    mode="aspectFill"
                  />
                  {hidden()
                    ? (
                        <view class="status-media-sensitive">
                          <text class="status-media-sensitive-text">Sensitive content</text>
                        </view>
                      )
                    : null}
                </view>
              )
            : null
        )}
      </For>
    </view>
  )
}
render(() => <StatusMedia />)
`

function opCodes(batches: unknown[][]): number[] {
  const codes: number[] = []
  for (const batch of batches) {
    for (const op of iterOps(batch as unknown[]))
      codes.push(op[0] as number)
  }
  return codes
}

describe('elk tap-to-reveal through the full pipeline', () => {
  it('tap unblurs the image and removes the mask', async () => {
    resetOpsBuffer()
    resetFlushState()
    resetShadowState()
    resetRegistry()
    resetNodeOpsState()
    resetLynxTemplateState()
    resetMainThreadRefState()
    resetApplyOpsState()
    delete g.__previewOpened

    const scene = compileDomModule(SRC)
    const host = installFakePapi()
    resetApplyOpsState()
    ;(g.renderPage as () => void)()
    for (const t of scene.templates)
      // eslint-disable-next-line no-eval
      registerSkeleton(t.id, eval(`(${t.createCode})`))

    const received: unknown[][] = []
    setOpsExecutor(ops => received.push([...ops]))
    const file = fileURLToPath(new URL('../tmp-elk-reveal.mjs', import.meta.url))
    writeFileSync(
      file,
      scene.code
        .replaceAll('@lynx-solid/runtime/lynx-template', '../packages/runtime/src/background/lynx-template.ts')
        .replaceAll('@lynx-solid/runtime', '../packages/runtime/src/index.ts'),
    )
    try {
      await import(pathToFileURL(file).href)
      await flushPromises()
    }
    finally {
      rmSync(file, { force: true })
    }
    for (const batch of received)
      applyOps(batch)

    // Mount: masked + blurred.
    const outer = host.root.children[0]!
    const item = outer.children[0]!
    const img = item.children[0]!
    expect(img.attrs.style).toMatchObject({ filter: 'blur(30px)' })
    expect(item.children.map(c => c.type)).toContain('view')
    const sign = item.events[0]!.sign as string
    expect(typeof sign).toBe('string')

    // Tap the mask → reveal, no preview yet.
    received.length = 0
    publishEvent(sign, {})
    await flushPromises()
    const codes = opCodes(received)
    expect(codes).toContain(OP.SET_STYLE)
    expect(codes).toContain(OP.REMOVE)
    // No new text may be created for the reveal itself.
    expect(codes).not.toContain(OP.CREATE_TEXT)
    for (const batch of received)
      applyOps(batch)
    expect(takeOps()).toEqual([])

    expect(img.attrs.style).toMatchObject({ filter: 'blur(0px)' })
    expect(item.children.map(c => c.type)).not.toContain('view')
    expect(g.__previewOpened).toBeUndefined()

    // Second tap (revealed) opens the preview.
    publishEvent(sign, {})
    await flushPromises()
    expect(g.__previewOpened).toBe(true)
  })
})
