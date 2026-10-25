import { defineConfig } from '@rslib/core'

/**
 * Dev-copy build for the forked dom-expressions babel plugin.
 *
 * Output goes INTO the source tree (babel-plugin-jsx-lynx/dist/) — that copy
 * is consumed by packages/compiler/src/dom-compile.ts when running inside the
 * repo (tests, dev servers). The published copy is built by the main
 * rslib.config.ts into dist/jsx-lynx.cjs.
 *
 * Keep this as a separate tiny config so `test` / `verify:unit` can
 * rebuild just this artifact without re-running the full package build
 * (api-extractor alone costs seconds).
 */
export default defineConfig({
  lib: [
    {
      id: 'compiler-jsx-lynx-dev',
      format: 'cjs',
      bundle: true,
      source: {
        entry: {
          index: './babel-plugin-jsx-lynx/src/index.ts',
        },
        tsconfigPath: './tsconfig.build.json',
      },
      output: {
        distPath: { root: './babel-plugin-jsx-lynx/dist' },
        cleanDistPath: false,
        externals: [
          '@babel/helper-module-imports',
          '@babel/plugin-syntax-jsx',
          '@babel/types',
          'html-entities',
        ],
      },
    },
  ],
})
