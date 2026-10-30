# @lynx-solid/runtime

Solid 2 runtime for [Lynx](https://lynxjs.org) — a dual-thread renderer where the
background thread (BG) owns reactivity and the main thread (MT) owns element
instantiation.

- **BG** runs Solid's component graph and turns dynamic bindings into a compact
  ops stream.
- **MT** applies those ops against pre-built static skeletons, so a template
  instance costs one `INSTANTIATE` and a handful of property writes.
- Both threads share one ops protocol (`@lynx-solid/runtime/internal`), so the
  public surface here is just the pieces an app and the build plugin need.

## Install

```bash
npm install @lynx-solid/runtime solid-js
```

`solid-js` is a peer dependency: the app and the runtime must share one copy of
Solid, otherwise signals created in one module graph are invisible to the other.

Building an app also needs the rsbuild plugin and its peers:

```bash
npm install -D @lynx-solid/plugin @lynx-js/rsbuild-plugin @rsbuild/core @lynx-js/types typescript
```

## Usage

```tsx
import { render } from '@lynx-solid/runtime'
import { createSignal } from 'solid-js'

function Counter() {
  const [count, setCount] = createSignal(0)
  return (
    <view bindtap={() => setCount(c => c + 1)}>
      <text>
        count:
        {count()}
      </text>
    </view>
  )
}

render(() => <Counter />)
```

Point TypeScript at the Lynx JSX runtime:

```jsonc
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@lynx-solid/runtime"
  }
}
```

## Entry points

| Subpath | Purpose |
| --- | --- |
| `@lynx-solid/runtime` | App-facing API: `render`, control flow helpers |
| `@lynx-solid/runtime/jsx-runtime` | JSX typing (`IntrinsicElements` for `<view>`, `<text>`, …) |
| `@lynx-solid/runtime/lynx-template` | BG template registry produced by the compiler |
| `@lynx-solid/runtime/main-thread` | MT bootstrap, invoked by the emitted template |
| `@lynx-solid/runtime/bootstrap` | BG entry shim (installed by the plugin) |
| `@lynx-solid/runtime/ifr-runtime` | MT IFR (isolated first render) runtime |

## Documentation

<https://axuj.github.io/lynx-solid/>

This is an unofficial community project, not an official Solid or Lynx package.

## License

MIT
