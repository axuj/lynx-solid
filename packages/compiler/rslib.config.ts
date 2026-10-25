import { defineConfig } from '@rslib/core'

/**
 * Bundled outputs of the @lynx-solid/compiler package.
 *
 * Only the forked dom-expressions babel plugin needs a bundler (standalone
 * CJS dist/jsx-lynx.cjs, loadable via createRequire from dom-compile at
 * runtime). The index (dom-compile + worklet-utils) rides plain `tsc -b`
 * instead — all its deps are external, so a "bundle" would bundle nothing.
 *
 * Host deps (babel core set, html-entities) stay external.
 */
export default defineConfig({
  lib: [
    {
      id: 'jsx-lynx',
      format: 'cjs',
      bundle: true,
      source: {
        entry: {
          'jsx-lynx': './babel-plugin-jsx-lynx/src/index.ts',
        },
        tsconfigPath: './tsconfig.build.json',
      },
      output: {
        distPath: { root: './dist' },
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
