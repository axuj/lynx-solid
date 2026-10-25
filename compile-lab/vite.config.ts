import type { Plugin } from 'vite'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import solid from '@solidjs/vite-plugin'
import { fileRoutes } from 'filesystem-routing/vite'
import { defineConfig } from 'vite'
import { lynxPreviewMiddleware } from './src/server/static-middleware.ts'

// Serves the rsbuild build output (/dist/*) and the web-core static assets
// (/static/*) the <lynx-view> host loads.
function lynxPreview(): Plugin {
  return {
    name: 'lynx-preview',
    configureServer(server) {
      server.middlewares.use(lynxPreviewMiddleware())
    },
  }
}

export default defineConfig({
  // The lab runs from the repo root (`nub run lab:dev`), so pin the root to
  // this directory — entries, middleware and route scans stay relative here.
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Turnkey entries: no index.html and no entry files — the plugin
  // generates them around src/App.tsx, wrapped in src/Document.tsx.
  plugins: [
    // First in the chain: the turnkey middleware (createAPIHandler) 404s
    // non-HTML requests before vite's static serving, so the preview
    // middleware must run before it.
    lynxPreview(),
    solid({
      start: {
        // Fetch-style chain fronting every request: dispatches API routes.
        middleware: './src/middleware.ts',
      },
      // Static shell + API server: pages render on the client while API
      // routes keep working server-side. No SSR rendering.
      ssr: false,
      // `extensions` makes @solidjs/vite-plugin also compile the `?pick=`
      // route modules the fileRoutes plugin emits.
      extensions: ['.jsx', '.tsx'],
    }),
    // `httpMethods` also scans route modules for GET/POST/... exports (API
    // routes). One router serves both sides: handler modules — and the
    // server-only code they import — never enter the client bundle.
    fileRoutes({ httpMethods: true, types: true }),
  ],
  resolve: {},
  server: {
    port: 5173,
    // The in-repo runtime sources (../../packages) are served through vite
    // (esbuild transform) instead of node's raw loader.
    fs: {
      allow: ['..'],
    },
    watch: {
      // The rsbuild build dir is rewritten on every compile request; keep
      // vite from reacting to it.
      ignored: ['**/.build/**'],
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  build: {
    target: 'esnext',
    // Keep images as asset files instead of inlining them into the JS bundle.
    assetsInlineLimit: 0,
  },
})
