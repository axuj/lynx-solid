import process from 'node:process'
import { pluginSolidLynx } from '@lynx-solid/plugin'
import { defineConfig } from '@rsbuild/core'

// Injected by packages/benchmark/harness/device.mjs before build so the
// page knows where to POST its results (avoids guessing launch-query APIs).
const reportUrl = process.env.DEVICE_REPORT_URL ?? ''
const tapWaitMs = Number(process.env.DEVICE_TAP_WAIT_MS ?? 0)

// `LYNX_MT_IFR=1` builds the IFR arm next to the default one, into `dist-ifr/`.
// The lab's MT probe reports which arm it is (`__DEVICE_LAB_ARM__`, defined
// below) plus how the thread's `queueMicrotask` got there, so a result can be
// attributed without guessing which bundle the device fetched.
const ifr = process.env.LYNX_MT_IFR === '1'

export default defineConfig({
  environments: {
    lynx: {},
    web: {},
  },
  source: {
    entry: {
      selftest: './src/index.tsx',
    },
    define: {
      __DEVICE_REPORT_URL__: JSON.stringify(reportUrl),
      __DEVICE_TAP_WAIT_MS__: JSON.stringify(tapWaitMs),
      __DEVICE_LAB_ARM__: JSON.stringify(ifr ? 'ifr' : 'default'),
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
