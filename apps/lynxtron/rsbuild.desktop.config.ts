import path from 'node:path'
import process from 'node:process'
import { pluginLynxtron } from '@lynx-js/lynxtron-dev-plugins/rsbuild'
import { defineConfig } from '@rsbuild/core'

// `pluginLynxtron` starts the app with `lynxtron` resolved from PATH, and the
// child inherits this process's environment. Package-manager shims (nub here)
// put their own Node first and inject `--require <preload>` through
// NODE_OPTIONS; the runtime is an Electron fork, applies NODE_OPTIONS to its
// main process, and then never runs main.js. Launch the app with the Node that
// runs this build and without the build tool's Node flags.
const appNodeDir = process.env.npm_node_execpath ? path.dirname(process.env.npm_node_execpath) : undefined
const appPath = [appNodeDir, process.env.PATH].filter(Boolean).join(path.delimiter)

// Desktop half of the app: the main process. It is a separate rsbuild build
// from the UI — `pluginSolidLynx` has no business compiling Node code.
//
// `pluginLynxtron` marks every dependency declared in package.json as external
// (they ship next to the app), launches `lynxtron dist/desktop` in dev, and
// restarts it on rebuild.
export default defineConfig(({ command }) => ({
  environments: {
    desktop: {
      source: {
        entry: {
          main: './src/main/desktop/main.ts',
        },
      },
      output: {
        target: 'node',
        distPath: {
          root: './dist/desktop',
        },
        copy: [
          // The runtime reads `main` from this manifest.
          { from: './package.json', to: 'package.json' },
          // In dev the window loads the bundle from the dev server, so the
          // UI build may not have written anything yet — only ship it in a
          // production build.
          ...(command === 'build' ? [{ from: './output/bundle/lynx/', to: '.' }] : []),
        ],
      },
      dev: {
        writeToDisk: true,
      },
      plugins: [
        pluginLynxtron({
          env: {
            // The child process is what decides dev vs production, and
            // `lynxtron` does not forward NODE_ENV for us. One explicit flag,
            // read in main.ts.
            LYNXTRON_DEV: '1',
            NODE_OPTIONS: '',
            PATH: appPath,
          },
        }),
      ],
    },
  },
}))
