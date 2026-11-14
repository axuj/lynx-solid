// Sparkling reads `lynxConfig` and hands it to Rspeedy, so this file is both
// the native-app manifest and the bundle build config.
//
// The one Solid-specific line is `pluginSolidLynx()`: it replaces ReactLynx's
// `pluginReactLynx()` and teaches the build how to split Solid JSX into a
// background-thread bundle + main-thread skeletons.
import type { AppConfig } from 'sparkling-app-cli'

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { defineConfig } from '@lynx-js/rspeedy'
import { pluginSolidLynx } from '@lynx-solid/plugin'
import { pluginTailwindCSS } from 'rsbuild-plugin-tailwindcss'

const lynxConfig = defineConfig({
  source: {
    entry: {
      main: './src/pages/main/index.tsx',
      second: './src/pages/second/index.tsx',
    },
  },
  output: {
    // Native builds load images/fonts out of the APK assets.
    assetPrefix: 'asset:///',
    filename: {
      bundle: '[name].lynx.bundle',
    },
  },
  plugins: [
    pluginQRCode({
      schema(url: string): string {
        // `?fullscreen=true` opens the page full screen in Lynx Explorer.
        return `${url}?fullscreen=true`
      },
    }),
    pluginSolidLynx(),
    pluginTailwindCSS({
      config: 'tailwind.config.ts',
      // Scan only this app's source: packages such as tailwind-merge ship raw
      // utilities that would otherwise be emitted into the bundle.
      exclude: [/[\\/]node_modules[\\/]/],
    }),
  ],
})

const config: AppConfig = {
  lynxConfig,
  appName: 'Solid on Sparkling',
  platform: {
    android: {
      packageName: 'com.lynxsolid.demo',
    },
    ios: {
      bundleIdentifier: 'com.lynxsolid.demo',
    },
  },
  paths: {
    androidAssets: 'android/app/src/main/assets',
  },
  appIcon: './resource/app_icon.png',
  plugin: [
    [
      'splash-screen',
      {
        backgroundColor: '#232323',
        image: './resource/app_icon.png',
        dark: {
          image: './resource/app_icon.png',
          backgroundColor: '#000000',
        },
        imageWidth: 200,
      },
    ],
  ],
}

export default config
