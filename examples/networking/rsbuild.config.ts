import process from 'node:process'
import { pluginSolidLynx } from '@lynx-solid/plugin'
import { defineConfig } from '@rsbuild/core'

// `LYNX_MT_IFR=1` builds the IFR variant next to the shipped one, into
// `dist-ifr/` — the docs' MT-IFR page embeds both from the same source (see
// website/scripts/prepare-examples.mjs). Plain `build` keeps the default arm.
const ifr = process.env.LYNX_MT_IFR === '1'

export default defineConfig({
  environments: {
    lynx: {},
    web: {},
  },
  source: {
    entry: {
      networking: './src/index.tsx',
    },
  },
  server: {
    host: '0.0.0.0',
    ...(process.env.LYNX_DEV_PORT ? { port: Number(process.env.LYNX_DEV_PORT) } : {}),
  },
  output: {
    distPath: { root: ifr ? 'dist-ifr' : 'dist' },
  },
  plugins: [pluginSolidLynx({ enableMtIfr: ifr })],
})
