Lynx Solid
Copyright 2026 axuj

This product contains code derived from or inspired by the following projects:

- vue-lynx (Apache-2.0)
  https://github.com/Huxpro/vue-lynx
  Copyright 2026-present Xuan Huang (huxpro)
  The reference for a dual-thread Lynx renderer built on a non-React framework.
  Several runtime modules and example polyfills are ported from it, some
  verbatim. Its vapor branch's ui-vdom/ui-react pair is what the benchmark
  workload is isomorphic to.
  Files: packages/runtime/src/background/run-on-background.ts,
  packages/runtime/src/main-thread/{index,list-apply,worklet-apply,
  run-on-background-mt}.ts, examples/elk/src/polyfills.ts,
  examples/hackernews/src/polyfills.ts

- Elk (MIT) — reached via vue-lynx's Elk example (Apache-2.0)
  https://github.com/elk-zone/elk
  https://github.com/Huxpro/vue-lynx/tree/main/examples/elk
  The examples/elk showcase is ported from vue-lynx's Elk example, which is
  itself a port of the Elk Mastodon client by Anthony Fu and the elk-zone team.
  We reuse Elk's framework-agnostic layers (masto.js API client, Mastodon-HTML
  content pipeline, domain logic, theme) and rebuild its UI on Lynx native
  elements.
  Files: examples/elk/**

- React Lynx / lynx-stack (Apache-2.0)
  https://github.com/lynx-family/lynx-stack
  Copyright Lynx Authors
  Conventions we follow rather than code we ship: the background-only marker
  package used to poison background-only modules, the shared-layer runtime
  model behind Main Thread Script, and the calibration baseline used by the
  benchmarks.

- lynx-examples (Apache-2.0)
  https://github.com/lynx-family/lynx-examples
  Copyright Lynx Authors
  Example structure. The examples/motion demo's layout and its theme chrome
  derive from it.

- dom-expressions (MIT)
  https://github.com/ryansolid/dom-expressions
  Copyright Ryan Carniato
  packages/compiler/babel-plugin-jsx-lynx is a hard fork of its babel-plugin-jsx
  package. It does not track upstream; changes land directly on the sources.
  See packages/compiler/babel-plugin-jsx-lynx/UPSTREAM.md for the base version,
  the file-by-file origin map, and any cherry-picked upstream commits.

- motion (MIT)
  https://motion.dev/
  The animation engine behind examples/motion. Used as a normal dependency; a
  React-free slice of @lynx-js/motion (Apache-2.0) is vendored as the Lynx
  element adapter.

- solid-js (MIT)
  https://github.com/solidjs/solid
  The reactivity core and component system. Used as-is, not modified — the same
  package and API as on the web; Lynx Solid only adds the renderer.

Brand assets: the documentation logo (`website/docs/public/logo.svg` and the
derived `logo-dark.svg` / `favicon.svg`) is Solid's folded-ribbon mark, taken
from the MIT-licensed solid-site artwork, with the lightning bolt of the
ReactLynx mark laid on the ribbon in a single neutral off-white, so the same
mark holds on both the light and the dark ribbon. The bolt path is the one in
the official `reactlynx-logo-light.svg` shipped by lynx-family/lynx-website
(Apache-2.0). The Lynx name and mark belong to the Lynx project. This project
is an independent
piece of work — it is not affiliated with, sponsored by, or endorsed by either
the Solid or the Lynx team. Both marks are used here only to indicate what this
library targets.

---

Lynx Solid itself is released under the MIT license (see LICENSE). Nothing in
this repository relicenses anyone else's work: ported and vendored code keeps
its own license and its authors' copyright notices. For the Apache-2.0 material
listed above, the license and notice requirements of Apache-2.0 continue to
apply to those parts.
