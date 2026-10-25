# lynx-solid

Solid 2 binding for [Lynx](https://lynxjs.org). Compiles Solid JSX into static
skeletons instantiated on the main thread (MT) while the background thread (BG)
drives dynamic holes through signals — one `INSTANTIATE` per template instance,
zero ops for static subtrees.

This repository is a monorepo. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) before
opening a pull request.

## Packages

| Package | Purpose |
| --- | --- |
| [`packages/runtime`](./packages/runtime) | `@lynx-solid/runtime` — the dual-thread runtime (BG renderer + MT bootstrap + ops protocol) |
| [`packages/compiler`](./packages/compiler) | `@lynx-solid/compiler` — Solid JSX → Lynx skeleton compiler, plus the dom-expressions fork it builds on |
| [`packages/plugin`](./packages/plugin) | `@lynx-solid/plugin` — `pluginSolidLynx()`, the rsbuild/rspeedy plugin that wires both threads together |
| [`packages/benchmark`](./packages/benchmark) | Device and bundle-size benchmarks |
| [`examples`](./examples) | Sample apps (counter, todomvc, 7guis, hackernews, elk, motion, …) |
| [`website`](./website) | Documentation site |
| [`compile-lab`](./compile-lab) | Compiler playground for inspecting generated skeletons |

## Install

```bash
npm install @lynx-solid/runtime
```

## Usage

Add the plugin to your `rsbuild.config.ts`:

```ts
import { pluginSolidLynx } from '@lynx-solid/runtime/plugin'
import { defineConfig } from '@rsbuild/core'

export default defineConfig({
  environments: { lynx: {}, web: {} },
  source: { entry: { main: './src/index.tsx' } },
  plugins: [pluginSolidLynx()],
})
```

Write components with Solid JSX and mount them:

```tsx
import { render } from '@lynx-solid/runtime'
import { createSignal } from 'solid-js'

function App() {
  const [n, setN] = createSignal(0)
  return (
    <view style="display:linear;linear-direction:column">
      <text>
        count:
        {n()}
      </text>
      <view bindtap={() => setN(n() + 1)}>
        <text>increment</text>
      </view>
    </view>
  )
}

render(() => <App />)
```

Requires `typescript` in the consuming project (the build loads TS configs).

## Runtime entry points

| Specifier | Purpose |
| --- | --- |
| `.` | BG runtime: `render` and cross-thread APIs (`initBackground` is auto-called by the plugin via `bootstrap.ts`); also the module compiled code imports universal helpers from |
| `./lynx-template` | Template instantiation helpers imported by generated code (`registerTemplate` / `insert` / …) |
| `./jsx-runtime` | JSX typings for Lynx intrinsics (`main-thread:*` props included) |
| `./plugin` | `pluginSolidLynx()` rsbuild plugin (registers the Lynx build engine itself) |

The main-thread bootstrap and internal ops protocol ship inside `dist/` but
are consumed by the plugin through file paths — they are not part of the
public export surface.

## How it works

The plugin splits each entry into two webpack layers:

- **Background** — user code compiled by a fork of dom-expressions'
  `babel-plugin-jsx` (`lynxTemplates` mode): static subtrees become
  `registerTemplate(id, …)` metadata; dynamic expressions compile to
  universal renderer calls that emit ops against numeric node refs.
- **Main thread** — a bootstrap plus per-entry skeleton modules whose
  `createCode` functions rebuild the static tree via PAPI, claiming ids
  `firstId + offset` so BG refs and MT elements align by construction.

## Development

This repo uses `nub` as its package manager (see the `packageManager` field in
`package.json`).

```bash
nub install

nub run lint           # eslint
nub run typecheck      # tsc -b across project references
nub run test           # Node protocol tests
nub run verify:unit    # behavior + compiler + control-flow port tests
nub run dev            # dev server for the elk example
nub run lab:dev        # compiler playground (:5173)
```

Full documentation lives in [`website/`](./website) — run
`nub run -F @lynx-solid/website dev` to browse it locally.

## License

[MIT](./LICENSE)

Parts of this repository are ports or adaptations of other open-source work —
vue-lynx, lynx-stack (React Lynx), lynx-examples, dom-expressions, Motion and
Elk. Those parts keep their own licenses; see
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
