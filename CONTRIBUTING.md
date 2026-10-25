# Contributing

## Setup

This repo uses `nub` as its package manager (see the `packageManager` field in
`package.json`). Install it first, then:

```bash
nub install
```

Adding or removing a dependency must go through `nub add` / `nub remove` —
hand-editing `package.json` gets rolled back by the next install.

`node_modules` is built from junctions into a content store, so **do not move
or rename the repository directory**. If the links break (module resolution
fails with `exports`/subpath errors), delete `node_modules` and run
`nub install` again.

## Verification

```bash
nub run lint              # eslint (antfu flat config)
nub run lint:fix          # autofix + --cache
nub run typecheck         # tsc -b across all project references
nub run test              # Node protocol tests (tests/protocol)
nub run verify:unit       # behavior + compiler + control-flow port tests
nub run build             # library build: tsc -b + compiler/plugin via rslib
nub run lab:dev           # compiler playground (:5173)
nub run lab:typecheck     # playground typecheck (its tsconfig is outside the root refs)
nub run bench:react-lynx  # ReactLynx comparison benchmark
```

You rarely need to run all of them. Scope the checks to what you touched:

- `packages/<pkg>` → `nub run -F <package-name> typecheck` plus
  `eslint <package-dir>`. Widen to downstream packages only when you changed a
  package others depend on (such as `runtime`).
- `examples/<demo>` → that example's `typecheck`. Only run `build` (and
  `prepare-examples` + `website build`) when you changed `rsbuild.config.ts` or
  need a fresh `dist/`.
- `website/docs` → `nub run -F @lynx-solid/website build` to check MDX compiles.

`prepare-examples` owns `examples/*/dist/` and `dist-ifr/`. It records the build
inputs of every arm it produces, so a rebuild run only remakes the arms whose
example sources, or the library packages they inline, actually changed — there
is nothing to delete by hand. Use `--force` when you want a guaranteed-fresh
package (`node website/scripts/prepare-examples.mjs --force`).

Two rules that will otherwise cost you time:

- Do not run `prepare-examples` / `website build` while an example dev server
  is running. Since rspeedy 0.17 `dev.writeToDisk` defaults to `true`, so a
  running dev server writes uncompressed dev bundles into `examples/*/dist/`.
  Such an arm is detected and rebuilt; if it still looks dev-form afterwards,
  the dev server is still writing and the run fails — stop it and rerun.
- After changing `packages/compiler/`, restart the dev server. The compiler is
  loaded through `require` cache and its `dist` is excluded from watch, so a
  stale module keeps running.

## Code conventions

### Type assertions

`as` / `as unknown as` is treated as an escape hatch. It is allowed only when
both hold:

1. The value crosses a system boundary — `JSON.parse`, `postMessage`, the flat
   ops stream, engine PAPI, third-party `any` — so the runtime type
   information is genuinely gone.
2. No narrowing tool works: `typeof`, `in`, `instanceof`, `Array.isArray`, a
   discriminated union, a type-guard function, or restructuring the type.

Every `as` carries a trailing comment explaining why, in this form:

```ts
// as: <boundary>, <why narrowing is impossible>
const data = JSON.parse(raw) as Payload // as: cross-boundary JSON, no narrowing possible
```

Reviews will ask for the comment or for the assertion to be removed.

### Custom globals

Custom globals on `globalThis` are declared in
`packages/runtime/src/internal/globals.d.ts` and accessed as `globalThis.x`.
Do not cast `globalThis` to `Record<string, unknown>`. Engine-injected PAPI
(`__CreateElement` and friends) is declared in
`packages/runtime/src/internal/papi.d.ts`.

### The dom-expressions fork

`packages/compiler/babel-plugin-jsx-lynx` is a hard fork of
[dom-expressions](https://github.com/ryansolid/dom-expressions). It is excluded
from lint on purpose, to keep the diff against upstream small. See its
[`UPSTREAM.md`](./packages/compiler/babel-plugin-jsx-lynx/UPSTREAM.md) before
editing it.

### Device-host differences

The web host is not the device host. These are the traps we have hit so far:

- **Timer callbacks do not receive arguments.** The native binding consumes
  only callback + delay and fires with zero args. Wrap instead of forwarding:
  `setTimeout(() => fn(a, b), ms)`, never `setTimeout(fn, ms, a, b)`.
- **Timers are not on `globalThis`** on the device background thread. Only the
  bare identifier resolves, so use `setTimeout(...)` directly rather than
  `globalThis.setTimeout.bind(...)`.
- **`queueMicrotask` has no bare global** on either device thread. The entry
  shim (`packages/runtime/src/internal/queue-microtask-shim.ts`, imported on
  the first line of both the BG and MT entries) installs the engine's
  `lynx.queueMicrotask` as a global.
- **The device baseline is ES2020.** The runtime no longer ships core-js, so
  `Object.hasOwn`, `Array.prototype.at` and `String.prototype.replaceAll` are
  unavailable. `packages/runtime` pins `lib: ES2020` so the compiler rejects
  them, and `tests/behavior/device-baseline.test.ts` guards against regressions.

## Solid 2.0 reference

This is a Solid 2 binding, not Solid 1.x. For signal / memo / effect / store /
props / control-flow / async / context / lazy semantics, read the cheat sheet
shipped with the package: `node_modules/solid-js/CHEATSHEET.md`, and
`MIGRATION.md` plus the `documentation/solid-2.0` RFCs next to it. React or
Solid 1.x intuition does not transfer.

## Commit messages

Format: `:emoji: type: message`, written in English.

| emoji | type | use for |
| --- | --- | --- |
| `:sparkles:` | feat | new feature |
| `:bug:` | fix | bug fix |
| `:construction_worker:` | ci | CI/CD |
| `:memo:` | docs | documentation |
| `:recycle:` | refactor | refactor |
| `:green_heart:` | fix/ci | CI fix |
| `:zap:` | perf | performance |
| `:art:` | style | code style |
| `:bookmark:` | chore | release |

## Pull requests

Keep the change focused, include the verification commands you ran, and note
any device-host behaviour you tested by hand (web-only testing is not enough
for runtime or compiler changes).
