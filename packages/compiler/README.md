# @lynx-solid/compiler

The compile pipeline behind [`@lynx-solid/plugin`](https://www.npmjs.com/package/@lynx-solid/plugin):
Solid JSX → Lynx skeletons.

- `dist/jsx-lynx.cjs` — a forked [dom-expressions](https://github.com/ryansolid/dom-expressions)
  Babel plugin that lowers JSX to `template`/`createComponent` calls and
  extracts the static MT template code;
- `dist/index.js` — `compileDomModule()`, the single-pass pipeline (fork plugin +
  TypeScript preset + async-to-promises) that produces the BG module and carries
  the extracted templates on `file.metadata`;
- worklet utilities used to split `main-thread` directives into their own module.

You normally get this package transitively through `@lynx-solid/plugin`. It is
published separately because the plugin loads it at build time and version
skew between the two would break the generated module shape.

## Usage

```ts
import { compileDomModule } from '@lynx-solid/compiler'

const { code, map, metadata } = compileDomModule(source, {
  filename: 'src/Counter.tsx',
  moduleName: '@lynx-solid/runtime/lynx-template',
})
```

## Documentation

<https://axuj.github.io/lynx-solid/>

The fork is kept intentionally close to upstream dom-expressions; see
`packages/compiler/babel-plugin-jsx-lynx/UPSTREAM.md` in the repository for the
pin and the local-diff policy.

## License

MIT
