import { createEffect, Show } from 'solid-js'

// <lynx-view> element from @lynx-js/web-core/client (loaded via /static).
//
// Mount strategy — "dispose, wait, then boot":
//   - A new bundle NEVER coexists with the old instance: web-core's
//     main-thread bundle is a shared singleton module, so an overlapping
//     instance would collide on its global element-id table.
//   - When the bundle changes we remove the old <lynx-view> and WAIT for its
//     async dispose to finish (its shadow root is cleared as the final
//     dispose step) before creating the replacement. Booting while the old
//     worker is still tearing down is what froze or broke the new render.
//   - Renders that do not produce content within the timeout are dropped
//     (the previous card is gone by then, so the preview just stays empty —
//     this is a rare failure, not a retried one).
const DISPOSE_WAIT_MS = 5000
const DISPOSE_POLL_MS = 100
// Large multi-file projects (elk: ~2MB bundle) can take well over 5s to
// decode and boot both threads before the first paint shows up.
const RENDER_WATCH_MS = 25000
const RENDER_POLL_MS = 200

function hasRenderedContent(view: any): boolean {
  const sr: ShadowRoot | undefined = view?.shadowRoot
  if (!sr)
    return false
  return !!sr.querySelector('x-view, x-text, scroll-view, x-scroll-view')
}

function isDisposed(view: any): boolean {
  // web-core's #disposeInstance clears the shadow root as its last step.
  return !view.isConnected && (!view.shadowRoot || view.shadowRoot.childNodes.length === 0)
}

export function LynxPreview(props: { url: () => string, key: () => number }) {
  let host: HTMLDivElement | undefined
  let pendingUrl: string | null = null
  let booting = false

  function boot(url: string) {
    if (!host || booting)
      return
    booting = true
    const old = host.lastElementChild
    const startNew = () => {
      booting = false
      if (pendingUrl) {
        const next = pendingUrl
        pendingUrl = null
        boot(next)
      }
      else {
        createView(url)
      }
    }
    if (old && old.tagName.toLowerCase() === 'lynx-view') {
      // Dispose the old instance, wait for teardown, then boot the new one.
      old.remove()
      const deadline = Date.now() + DISPOSE_WAIT_MS
      const poll = window.setInterval(() => {
        if (isDisposed(old) || Date.now() > deadline) {
          window.clearInterval(poll)
          startNew()
        }
      }, DISPOSE_POLL_MS)
    }
    else {
      booting = false
      createView(url)
    }
  }

  function createView(url: string) {
    if (!host)
      return

    const view: any = document.createElement('lynx-view')
    view.style.cssText = 'width:100%;height:100%;display:block;background:#fff'
    view.browserConfig = {
      pixelWidth: 390 * window.devicePixelRatio,
      pixelHeight: 844 * window.devicePixelRatio,
    }
    view.url = url
    host.appendChild(view as HTMLElement)

    // A render that never produces content is dropped instead of kept
    // half-broken on screen. `poll` is declared first: the two timers
    // reference each other, so one of them must be a let.
    let poll: number | undefined
    const deadline = window.setTimeout(() => {
      if (poll !== undefined)
        window.clearInterval(poll)
      if (view.isConnected && !hasRenderedContent(view))
        view.remove()
    }, RENDER_WATCH_MS)

    poll = window.setInterval(() => {
      if (!hasRenderedContent(view))
        return
      window.clearTimeout(deadline)
      window.clearInterval(poll)
    }, RENDER_POLL_MS)
  }

  createEffect(
    () => [props.url(), props.key()] as const,
    ([u, k]) => {
      if (!u)
        return
      // The bundle URL is stable across rebuilds; the build key busts the
      // lynx-view template cache so a recompiled bundle actually reloads.
      const url = `${u}?v=${k}`
      if (booting) {
        // A mount is in flight (waiting for dispose) — take the latest
        // bundle so rapid auto-compiles coalesce into one boot.
        pendingUrl = url
      }
      else {
        boot(url)
      }
    },
  )

  return (
    <div
      ref={host}
      style={{
        width: '100%',
        height: '100%',
        background: '#0d1117',
      }}
    >
      <Show when={!props.url()}>
        <div class="preview-empty">compile to preview the rendered result</div>
      </Show>
    </div>
  )
}
