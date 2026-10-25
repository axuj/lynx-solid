import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Pin solid-js to the client build. Without this, vitest resolves the
    // "development" export condition to dist/server.js (the SSR build, where
    // createEffect is a no-op) and gives tests a second solid-js instance
    // next to the one used by @solidjs/universal — reactivity silently dies.
    alias: {
      // Subpath FIRST: the bare `solid-js` entry below matches by prefix, so
      // with only that one, `solid-js/internal` — imported by
      // @solidjs/universal since rc.18 — rewrites to `dist/solid.js/internal`
      // and the whole behaviour suite fails to collect.
      'solid-js/internal': fileURLToPath(
        new URL('./node_modules/solid-js/dist/internal.js', import.meta.url),
      ),
      'solid-js': fileURLToPath(
        new URL('./node_modules/solid-js/dist/solid.js', import.meta.url),
      ),
      // Workspace packages resolve to source (matching tsconfig paths): the
      // dist bundles may not exist during tests.
      '@lynx-solid/compiler': fileURLToPath(
        new URL('./packages/compiler/src/index.ts', import.meta.url),
      ),
      '@lynx-solid/runtime': fileURLToPath(
        new URL('./packages/runtime/src/index.ts', import.meta.url),
      ),
      '@lynx-solid/runtime/': fileURLToPath(
        new URL('./packages/runtime/src/', import.meta.url),
      ),
      '@lynx-solid/plugin': fileURLToPath(
        new URL('./packages/plugin/src/index.ts', import.meta.url),
      ),
    },
    conditions: ['browser'],
  },
  test: {
    server: {
      deps: {
        // Keep a single solid-js instance: the test file, @solidjs/universal
        // and @dom-expressions/runtime all go through the vite-processed copy
        // (the alias above) instead of node resolving their imports to the
        // SSR build.
        inline: ['solid-js', '@solidjs/universal', '@dom-expressions/runtime'],
      },
    },
  },
})
