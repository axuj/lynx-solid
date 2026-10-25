import { networkInterfaces } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginSolidLynx } from '@lynx-solid/plugin'
import { defineConfig } from '@rsbuild/core'
import { TanStackRouterGeneratorRspack } from '@tanstack/router-plugin/rspack'

const root = path.dirname(fileURLToPath(import.meta.url))

// `LYNX_MT_IFR=1` builds the IFR variant next to the shipped one, into
// `dist-ifr/` — the docs' MT-IFR page embeds both from the same source (see
// website/scripts/prepare-examples.mjs). Plain `build` keeps the default arm.
const ifr = process.env.LYNX_MT_IFR === '1'

function lanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith('192.168.'))
        return a.address
    }
  }
  return 'localhost'
}

export default defineConfig({
  environments: {
    lynx: {},
    web: {},
  },
  source: {
    entry: {
      elk: './src/index.tsx',
    },
  },
  tools: {
    rspack: {
      cache: false,
      plugins: [
        TanStackRouterGeneratorRspack({
          target: 'solid',
          routesDirectory: path.resolve(root, 'src/routes'),
          generatedRouteTree: path.resolve(root, 'src/routeTree.gen.ts'),
        }),
      ],
      optimization: {
        splitChunks: false,
        runtimeChunk: false,
      },
    },
  },
  server: {
    host: '0.0.0.0',
    ...(process.env.LYNX_DEV_PORT ? { port: Number(process.env.LYNX_DEV_PORT) } : {}),
  },
  output: {
    distPath: { root: ifr ? 'dist-ifr' : 'dist' },
  },
  resolve: {
    alias: {
      // change-case@5 uses Unicode regexes unsupported by PrimJS regexp —
      // route to ASCII adapter (same as upstream vue-lynx elk example).
      'change-case': path.resolve(root, 'src/composables/change-case.ts'),
    },
  },
  plugins: [
    pluginQRCode({
      schema(url) {
        return url.replace(/0.0.0.0|localhost/, lanIp())
      },
    }),
    pluginSolidLynx({
      enableCSSInlineVariables: true,
      enableMtIfr: ifr,
    }),
  ],
})
