import { defineConfig } from '@rslib/core'

/**
 * Bundled targets of the publishable @lynx-solid/plugin package.
 *
 *   - index        pluginSolidLynx (the whole chain setup). The fork dom
 *                  pipeline rides along as a runtime dependency on
 *                  @lynx-solid/compiler (external, resolved from node_modules).
 *   - loaders      skeleton-loader + worklet-mt-loader as separate entries
 *                  (consumed by path via require.resolve inside the plugin;
 *                  no public type surface, so built without dts).
 *
 * Host/babel deps stay external.
 */
export default defineConfig({
  lib: [
    {
      id: 'index',
      format: 'esm',
      syntax: 'es2022',
      dts: { bundle: true },
      source: {
        entry: {
          index: './src/index.ts',
        },
        tsconfigPath: './tsconfig.build.json',
      },
      output: {
        distPath: { root: './dist' },
        cleanDistPath: false,
        externals: [
          '@rsbuild/core',
          '@lynx-js/rsbuild-plugin',
          '@lynx-solid/compiler',
          '@lynx-solid/runtime',
          '@babel/core',
          '@babel/helper-module-imports',
          '@babel/parser',
          '@babel/plugin-syntax-jsx',
          '@babel/preset-typescript',
          '@babel/traverse',
          '@babel/types',
          '@lynx-js/react/transform',
          '@lynx-js/runtime-wrapper-webpack-plugin',
          '@lynx-js/template-webpack-plugin',
          'babel-plugin-transform-async-to-promises',
          'html-entities',
        ],
      },
    },
    {
      id: 'loaders',
      format: 'esm',
      syntax: 'es2022',
      source: {
        entry: {
          'loaders/skeleton-loader': './src/skeleton-loader.ts',
          'loaders/worklet-mt-loader': './src/worklet-mt-loader.ts',
          'loaders/invalid-import-error-loader': './src/invalid-import-error-loader.ts',
          'loaders/server-functions-stub': './src/server-functions-stub.ts',
        },
        tsconfigPath: './tsconfig.build.json',
      },
      output: {
        distPath: { root: './dist' },
        cleanDistPath: false,
        externals: [
          '@rsbuild/core',
          '@lynx-js/rsbuild-plugin',
          '@lynx-solid/compiler',
          '@lynx-solid/runtime',
          '@babel/core',
          '@babel/helper-module-imports',
          '@babel/parser',
          '@babel/plugin-syntax-jsx',
          '@babel/preset-typescript',
          '@babel/traverse',
          '@babel/types',
          '@lynx-js/react/transform',
          '@lynx-js/runtime-wrapper-webpack-plugin',
          '@lynx-js/template-webpack-plugin',
          'babel-plugin-transform-async-to-promises',
          'html-entities',
        ],
      },
    },
  ],
})
