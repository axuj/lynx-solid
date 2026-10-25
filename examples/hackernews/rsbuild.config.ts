import { networkInterfaces } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginSolidLynx } from '@lynx-solid/plugin'
import { defineConfig } from '@rsbuild/core'
import { TanStackRouterGeneratorRspack } from '@tanstack/router-plugin/rspack'
import { pluginTailwindCSS } from 'rsbuild-plugin-tailwindcss'

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
      hackernews: './src/index.tsx',
    },
  },
  tools: {
    rspack: {
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
    pluginTailwindCSS({
      config: 'tailwind.config.ts',
      exclude: [/[\\/]node_modules[\\/]/],
    }),
  ],
})
