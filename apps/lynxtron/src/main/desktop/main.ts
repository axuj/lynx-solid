import path from 'node:path'
import process from 'node:process'
import { app, clipboard, devtool, lynxBridge, LynxWindow } from '@lynx-js/lynxtron'

// Set by `pluginLynxtron({ env })` in rsbuild.desktop.config.ts. `lynxtron`
// does not forward NODE_ENV to the app, so dev/production cannot be told apart
// from it.
const isDev = process.env.LYNXTRON_DEV === '1'
// 127.0.0.1, not localhost: the UI server binds IPv4, and on Windows
// `localhost` can resolve to ::1 — where a second dev server (this one) may be
// listening and answering 404 for the bundle.
const devUrl = `http://127.0.0.1:${process.env.LYNX_DEV_PORT ?? '3000'}/main.lynx.bundle`

/**
 * The UI dev server and this build start in parallel. This build is usually
 * ready first (it is a handful of files), so loading the URL immediately hits a
 * connection refused — and a failed first load leaves the window blank for
 * good. Wait for the server instead of loading a dead page.
 */
async function waitForDevServer(url: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok)
        return
    }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  process.stderr.write(`[demo] ${url} did not respond after ${timeoutMs}ms, loading anyway\n`)
}

app.whenReady().then(async () => {
  // Without this the window still runs, but `agent-lynx` (and the Lynx DevTool)
  // cannot find a session to inspect.
  if (isDev) {
    devtool.setDevToolEnabled(true)
    devtool.setLogboxEnabled(true)
    await waitForDevServer(devUrl)
  }

  const win = new LynxWindow({
    width: 720,
    height: 640,
    minWidth: 560,
    minHeight: 480,
    title: 'Lynx Solid × Lynxtron',
    backgroundColor: '#0b0d12',
    show: false,
  })

  // main → UI: `sendGlobalEvent` lands on
  // `lynx.getJSModule('GlobalEventEmitter')` in the UI bundle.
  const emit = (event: string, payload: unknown) => win.sendGlobalEvent(event, payload)

  // UI → main: `NativeModules.bridge.call(method, params)`. 0.0.31 exposes
  // `call` / `on` only — the `send` in the newer docs does not exist yet.
  lynxBridge.handle('demo:ping', () => {
    emit('demo:pong', {
      pid: process.pid,
      platform: `${process.platform}/${process.arch}`,
      node: process.versions.node,
      time: new Date().toLocaleTimeString(),
    })
    return ''
  })

  lynxBridge.handle('demo:copy', (_event, args) => {
    const text = String((args as { text?: unknown } | undefined)?.text ?? '')
    clipboard.writeText(text)
    // Read it back, so the UI shows what the system holds rather than what it
    // asked for.
    emit('demo:clipboard', clipboard.readText())
    return ''
  })

  // 0.0.31's d.ts documents `ready-to-show` but does not declare it on `on`.
  // The timeout is the safety net: a hidden window that never shows looks like
  // a crash, and this event has moved between releases.
  let shown = false
  const show = () => {
    if (shown)
      return
    shown = true
    win.show()
  }
  ;(win as any).on('ready-to-show', show)
  setTimeout(show, 3000)
  win.on('closed', () => app.quit())

  const globalProps = { window: 'main', launchedAt: new Date().toISOString() }
  if (isDev)
    win.loadURL(devUrl, { globalProps })
  else
    win.loadFile(path.join(__dirname, 'main.lynx.bundle'), { globalProps })
})
