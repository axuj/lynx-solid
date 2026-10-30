# @lynx-solid/plugin

The rsbuild (and rspeedy) plugin for [`@lynx-solid/runtime`](https://www.npmjs.com/package/@lynx-solid/runtime).

It wires the two threads together:

- splits the entry into a **BG** bundle and an **MT** bundle, and injects the
  background bootstrap;
- runs the forked dom-expressions Babel pipeline from
  [`@lynx-solid/compiler`](https://www.npmjs.com/package/@lynx-solid/compiler)
  so JSX becomes static LX templates plus a dynamic ops program;
- emits the LX template through the official Lynx template plugin, and stages
  the worklet loaders and skeleton modules the MT needs.

You normally do not install this package on its own — it is the build-time
counterpart of the runtime:

```bash
npm install solid-js @lynx-solid/runtime
npm install -D @lynx-solid/plugin @lynx-js/rsbuild-plugin @rsbuild/core @lynx-js/types typescript
```

## Usage

```ts
import { pluginSolidLynx } from '@lynx-solid/plugin'
import { defineConfig } from '@rsbuild/core'

export default defineConfig({
  environments: {
    lynx: {},
    web: {},
  },
  source: {
    entry: { main: './src/index.tsx' },
  },
  plugins: [pluginSolidLynx()],
})
```

`npm run dev` then serves the Lynx bundle, the web bundle and a browser preview.

## Peer dependencies

| Peer | Why |
| --- | --- |
| `@rsbuild/core` | The plugin object is consumed by the app's rsbuild instance |
| `@rspack/core` | Rules and `DefinePlugin` are configured on the rspack chain |
| `solid-js` | Resolved from the app so BG and MT share one Solid copy |
| `@solidjs/signals` | The MT needs its own lowered copy for the IFR path |

## Documentation

<https://axuj.github.io/lynx-solid/>

Unofficial community project, not affiliated with the Solid or Lynx teams.

## License

MIT
