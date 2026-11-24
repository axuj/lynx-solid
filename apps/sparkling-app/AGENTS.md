# AGENTS.md — Solid on Sparkling

This example is a real Android app: Solid 2 renders through Lynx inside a
Sparkling native shell. `README.md` covers setup, cold-start numbers and
limitations; this file only records the constraints that are easy to break.

## Invariants

- UI is **Solid 2** via `@lynx-solid/runtime`. Never import `@lynx-js/react`,
  `react`, `useState`/`useEffect`, or `root.render`.
- Mount with `render(() => <App />)`; the lifecycle hook is `onSettled`; JSX
  uses Solid attributes (`class=`, `style={{ ... }}`, `bindtap=`).
- Build with `rspeedy` + `pluginSolidLynx()`. Do not add `pluginReactLynx()`.
- Styling is **Tailwind v3** + `@lynx-js/tailwind-preset`. Utilities live in
  the page JSX; `src/App.css` keeps the `@tailwind` directives and the page
  gradient. v4 (`@tailwindcss/postcss`) is unsupported, the preset is
  experimental (no hover/focus/media variants), and class names must be static
  strings — `bg-${color}` is invisible to JIT.
- Do not edit `android/` Kotlin unless the task is native. Do not rename the
  applicationId (`com.lynxsolid.demo`) without updating `app.config.ts` and
  `scripts/android.mjs`.
- Do not upgrade Gradle, AGP, Kotlin or the JDK in isolation: Sparkling 2.0.1
  pins Gradle 8.2 / AGP 7.4.2 / Kotlin 1.8.10, and Lynx 3.6 targets SDK 3.2.
  The template default is JDK 11; this example uses 17. Keep all five Java
  pins in sync: `targetJavaVersion`, `jvmToolchain`, `sourceCompatibility`,
  `targetCompatibility`, `jvmTarget`.
- Keep the launch path: `AppLaunchTheme` paints the starting window, Fresco
  initializes off the main thread, and `release` is debug-signed for
  sideloading only — never ship that signature.
- Keep the three `LynxEnv` switches (`enableLynxDebug`, `enableDevtool`,
  `enableLogBox`) **after** `HybridKit.initLynxKit()`, under `BuildConfig.DEBUG`.
  That call runs `LynxEnv.init`; before it `enableLynxDebug` bails without a
  context and `setDevtoolEnv` is guarded by `isNativeLibraryLoaded()`. The 2.0.1
  template sets them before, where they record flags and do nothing — no error,
  but nothing listens on 8901 and `agent-lynx` finds no client. They are the
  only debug-only wiring in the shell; release must not carry any of it.

## Commands

```bash
nub install
nub run typecheck   # tsc --noEmit
nub run build       # bundles + copy assets into android/app/src/main/assets
nub run dev         # Rspeedy dev server (Lynx Explorer)
nub run toolchain   # print the resolved JDK / Android SDK
nub run android     # bundle + copy + gradle assembleDebug (+ install/launch)
nub run autolink    # after adding a sparkling-* method package
```

`scripts/toolchain.mjs` resolves the JDK and SDK for every `nub run android`:
`.env.local` (gitignored) → environment → `android/local.properties` → common
install locations. `nub run toolchain` prints which one won; start from
`.env.example` if your toolchain lives elsewhere.

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

## Layout

| Path | Purpose |
|---|---|
| `app.config.ts` | Sparkling manifest + `lynxConfig` (Rspeedy/Rsbuild config) |
| `lynx.config.ts` | Thin wrapper so the raw `rspeedy` CLI builds `app.config.ts` |
| `src/pages/main/index.tsx` | Entry #1 → `main.lynx.bundle` |
| `src/pages/second/index.tsx` | Entry #2 → `second.lynx.bundle` |
| `tailwind.config.ts` | Lynx Tailwind preset + color tokens |
| `src/App.css` | `@tailwind` directives + the page gradient |
| `android/` | Generated Sparkling native shell (Kotlin, Gradle 8.2, Lynx 3.6) |
| `scripts/android.mjs` | build → copy assets → gradle → install → launch |
| `scripts/copy-assets.mjs` | `dist/` → Android assets (no iOS tree) |

## Version bridge

Sparkling 2.0.1 ships Rspeedy 0.13 / Rsbuild 1.7. `@lynx-solid/plugin` needs
Rsbuild 2, so `package.json` pins `@lynx-js/rspeedy@^0.18.5` (Rsbuild 2.3.2).
`pluginSolidLynx()` detects the already-registered `lynx:rsbuild` plugin and
does not double-register it. Removing this pin breaks the build.

## Traps

- Windows: the Sparkling CLI's `build` / `run:android` cannot resolve
  `rspeedy.cmd`; use the nub scripts. Its `autolink` also fails to read
  `app.config.ts` and falls back to the default directory layout (which is
  ours). Do not move directories to "fix" it.
- `sparkling doctor` is unreliable here: it can report the JDK as missing even
  when `java -version` works, and it rejects Node 26. Trust
  `nub run build` / `nub run android`.
- This example is **Android only**. `nub run build` copies bundles with
  `scripts/copy-assets.mjs` (the CLI's `copy-assets` also writes an iOS tree),
  and `autolink` runs with `--platform android`. Do not add an iOS shell, a
  `--ios-dest` flag or CocoaPods files back: they were removed on purpose.
- Report cold-start numbers from a release build only; debug includes the
  devtool/logbox/debug engine.
- The 2.1 dev-server path was only verified to "relaunch picks up the new
  bundle"; the docs' save-triggers-HMR relies on `pluginReactLynx` and is
  unverified for the Solid plugin. Do not claim hot replace.
