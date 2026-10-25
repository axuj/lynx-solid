import process from 'node:process'
import { pluginSolidLynx } from '@lynx-solid/plugin'
import { defineConfig } from '@rsbuild/core'

export default defineConfig({
  environments: {
    lynx: {},
    web: {},
  },
  source: {
    entry: {
      mini: './src/index.ts',
    },
  },
  server: {
    host: '0.0.0.0',
    ...(process.env.LYNX_DEV_PORT ? { port: Number(process.env.LYNX_DEV_PORT) } : {}),
  },
  output: {
    distPath: { root: 'dist' },
  },
  plugins: [pluginSolidLynx()],
})
