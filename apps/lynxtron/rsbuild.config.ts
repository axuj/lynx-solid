import process from 'node:process'
import { pluginSolidLynx } from '@lynx-solid/plugin'
import { defineConfig } from '@rsbuild/core'
import { pluginTailwindCSS } from 'rsbuild-plugin-tailwindcss'

// UI half of the app. The Lynxtron shell loads bundles from
// `output/bundle/lynx/` — that directory name is the official desktop
// scaffold's convention, not ours. The `web` environment is unused (a desktop
// app has no browser preview), but the plugin splits every entry per
// environment, so it has to be declared.
export default defineConfig({
  environments: {
    lynx: {
      output: {
        distPath: { root: 'output/bundle/lynx' },
      },
    },
    web: {},
  },
  source: {
    entry: {
      main: './src/index.tsx',
    },
  },
  server: {
    host: '0.0.0.0',
    ...(process.env.LYNX_DEV_PORT ? { port: Number(process.env.LYNX_DEV_PORT) } : {}),
  },
  output: {
    distPath: { root: 'dist' },
  },
  plugins: [
    pluginSolidLynx(),
    pluginTailwindCSS({
      config: 'tailwind.config.ts',
      // Scan only this app's source: packages such as tailwind-merge ship raw
      // utilities that would otherwise be emitted into the bundle.
      exclude: [/[\\/]node_modules[\\/]/],
    }),
  ],
})
