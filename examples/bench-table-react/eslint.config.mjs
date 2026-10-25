/**
 * Package-local ESLint config (ESLint v10 file-relative lookup: the nearest
 * eslint.config.* applies to files under this directory).
 *
 * Deliberately standalone instead of importing the root config: the root
 * composition is for solid apps (`solid: true` — its `prefer-for`/
 * `prefer-show` rules nudge `.map()` lists toward `<For />`/`<Show />`,
 * which ReactLynx doesn't ship; following that nudge once produced
 * `import { For } from 'solid-js'` inside a React render, rendering zero
 * rows). This package is the ReactLynx twin of the benchmark app, so it
 * composes antfu WITHOUT the solid plugin — plain `.map()` stays legal and
 * the whole rule class can't fire. Repo-wide demo relaxations from the
 * root config's custom/dev-samples block are restated below (dir-anchored
 * root globs would re-anchor here anyway).
 */
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'app',
    typescript: true,
    formatters: false,
    // Globs in this file are anchored to this directory (ESLint v10 basePath).
    ignores: ['dist/', '**/dist/', '.rspeedy/', '**/.rspeedy/', '.rslib/'],
  },
  {
    name: 'bench-table-react/reactlynx-twin',
    rules: {
      'no-console': 'off',
      'ts/no-explicit-any': 'off',
    },
  },
)
