import { networkInterfaces } from 'node:os'
import process from 'node:process'
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginSolidLynx } from '@lynx-solid/plugin'

import { defineConfig } from '@rsbuild/core'

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
      'main-thread-draggable': './src/index.tsx',
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
    pluginQRCode({
      schema(url) {
        return url.replace(/0.0.0.0|localhost/, lanIp())
      },
    }),
    pluginSolidLynx({
      enableCSSInlineVariables: true,
    }),
  ],
})
