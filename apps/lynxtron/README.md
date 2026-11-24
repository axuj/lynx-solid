# Solid × Lynx × Lynxtron — a desktop app

This is not a web demo. It is a **Lynx app running in a native desktop window**:
[Lynxtron](https://github.com/lynx-family/lynxtron) is the shell, the window
content is a Solid 2 component tree rendered by this repository's runtime.

```
rsbuild.config.ts ──────────► output/bundle/lynx/main.lynx.bundle ─┐
  pluginSolidLynx()                                                │  copied into
                                                                   │  dist/desktop
rsbuild.desktop.config.ts ──► dist/desktop/main.js ────────────────┴► lynxtron
  pluginLynxtron()               (main process, Node)
```

## What the demo shows

- A signal-driven counter — the same `createSignal` you would write for a phone.
- A **UI → main** call (`NativeModules.bridge.call`) and a **main → UI** reply
  (`LynxWindow.sendGlobalEvent` → `lynx.getJSModule('GlobalEventEmitter')`).
  The main process answers with its pid, platform and Node version.
- A **native capability**: the main process writes to the system clipboard and
  reads it back, so the UI displays what the OS actually holds.
- `globalProps` passed at load time, read as `lynx.__globalProps`.

## Commands

```bash
nub install
nub run dev        # UI dev server + main process, restarts the app on rebuild
nub run build      # both halves: output/bundle/lynx + dist/desktop
nub run start      # build, then run the release-shaped app from dist/desktop
nub run typecheck  # tsc over both the UI and the main process
```

`nub run dev` starts the UI dev server on port 3000 (override with
`LYNX_DEV_PORT`), builds the main process, and launches the window. The first
`lynxtron` run downloads the desktop runtime into the npm cache (~180 MB on
Windows); later runs reuse it.

## The bridge, in full

```ts
// UI
NativeModules.bridge.call('demo:ping', { sentAt: Date.now() }, () => {})

// main
lynxBridge.handle('demo:ping', () => {
  win.sendGlobalEvent('demo:pong', { pid: process.pid, /* … */ })
  return ''
})

// UI again
lynx.getJSModule('GlobalEventEmitter').addListener('demo:pong', handler)
```

`NativeModules.bridge` in 0.0.31 has `call` and `on` only — the `send` in the
newer documentation does not exist yet. Replies go through `sendGlobalEvent`,
not a return value.

## Version pins

This app is **not part of the workspace** (the workspace lists only `packages/*`,
`examples/*` and `website`). It installs the published `@lynx-solid/*@0.1.1` packages
and the toolchain those were published against, exactly like a user's desktop
app would. That keeps the workspace install free of a desktop shell, and the
demo honest about what is on npm.

The pins are not arbitrary:

| Package | Pin | Why |
|---|---|---|
| `@lynx-js/lynxtron` | `0.0.31` | Current release; the runtime version follows the package version. |
| `@lynx-js/rsbuild-plugin` | `0.1.6` | The version `@lynx-solid/plugin@0.1.1` depends on. Declaring a newer one does not change what the plugin loads. |
| `@lynx-js/types` | `4.3.0` | `@lynx-solid/runtime@0.1.1`'s dependency range. |
| `solid-js` | `2.0.0-rc.18` | `@lynx-solid/runtime@0.1.1` pulls `@solidjs/universal@2.0.0-rc.18`; the signals version has to match it. |

When the next `@lynx-solid/*` release lands, bump these together — do not bump
one in isolation. `scripts/check-app-pins.mjs` (run in CI) fails when an
`@lynx-solid/*` pin here does not match the version in `packages/*`, which puts
the bump in the same pull request as the version change. The lockfile is what
records the combination this app was actually tested with; a caret range only
decides what a fresh install without one would resolve.

## Caveats

- Lynxtron is `0.0.x`. APIs move between releases; the comments in
  `src/main/desktop/main.ts` record what 0.0.31 actually does.
- Package managers can break the dev launcher. nub puts its own Node first on
  PATH and injects a `--require` preload through `NODE_OPTIONS`; the runtime is
  an Electron fork, applies `NODE_OPTIONS` to its main process, and then never
  runs `main.js` (the window never appears). `rsbuild.desktop.config.ts` hands
  the launcher the build's own Node and an empty `NODE_OPTIONS`.
- Windows and macOS only in windowed mode. On Linux the shell supports headless
  rendering only (`windowless: true`) — the constraint is stated in the
  package's own `apis/api/lynx-window.d.ts`, under the `windowless` field.
- `lynxtron` defaults to the DevTool-enabled runtime. `lynxtron-builder` (not
  used here) defaults to the release one — do not ship a devtool runtime.
- A preload script's isolated context does not get `LynxWindow` or `clipboard`;
  keep window control in the main process. This demo does not use a preload.
