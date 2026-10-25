import process from 'node:process'
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { defineConfig } from '@rsbuild/core'

export default defineConfig({
  environments: {
    lynx: {},
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
  plugins: [pluginReactLynx()],
})
