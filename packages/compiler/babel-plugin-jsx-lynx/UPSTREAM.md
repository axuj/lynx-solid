# Upstream (hard fork)

This directory is a **hard fork** of `packages/babel-plugin-jsx` from
[dom-expressions](https://github.com/ryansolid/dom-expressions). It does not
track upstream and has no sync script: changes land directly on the sources.

- Upstream repository: https://github.com/ryansolid/dom-expressions
- Base version: `0.50.0-next.42` (`package.json` version)
- Base commit: `3baff89`

Because the fork is deeply modified, upstream fixes are evaluated by hand
rather than merged blind. One cherry-pick is already included:

| Upstream commit | Outcome | Why |
| --- | --- | --- |
| `bba3db6c` (`children` attribute means child content) | Merged | Static/collapsible `children` attributes were compiled as template attributes, emitting `setAttribute(el, "children", …)` at runtime and losing the content. Landed in `src/dom/element.ts` with a regression test in `tests/compiler/children-attr.test.ts`. |

## Fork-specific files

| File | Contents |
| --- | --- |
| `src/dom/create-code.ts` | Serializes the skeleton into a main-thread `createCode` (`P.create` / `P.append`) |
| `src/lynx-worklet.ts` | Worklet capture + fnv1a ids |
| `src/types.ts` | Lynx types: `SkeletonNode`, `SkeletonAnchor`, `LynxExtractedTemplate`, … |
| `src/lynx-utils.ts` | Lynx-only helpers (effect wrapping, stateful form `prop:*` rewrite family), extracted from `shared/utils.ts` |

Other differences from the base: the template instance root (`rootId`) threads
through the `insert` / `setAttribute` parameter chain, and templates emit a
skeleton instead of an HTML template string. Upstream paths that can never run
here were removed wholesale: the hydratable suite, the SSR directory, HTML
validation (`isInvalidMarkup` + parse5), event delegation
(`delegateEvents`), and the universal/generate multi-renderer dispatch.

## File origins

`shared/` is derived from upstream. The `Origin` column below marks how far
each file has drifted.

| File | Origin | Notes |
| --- | --- | --- |
| `src/index.ts` | Mixed | Upstream pipeline shape + a worklet validation pass |
| `src/config.ts` | Mixed | Unused options removed; `staticMarker` rename allowlist |
| `src/lynx-utils.ts` | Lynx | See the table above |
| `src/lynx-worklet.ts` | Lynx | See the table above |
| `src/types.ts` | Lynx | See the table above |
| `src/dom/element.ts` | Lynx (rewritten) | Element compilation: attributes/events/worklets/dynamics all emit Lynx calls |
| `src/dom/template.ts` | Lynx (rewritten) | `registerTemplate` + skeleton/createCode instead of HTML strings |
| `src/dom/create-code.ts` | Lynx | See the table above |
| `src/dom/constants.ts` | Verbatim | Byte-identical to upstream |
| `src/dom/scope-adapter.ts` | Lynx | Scoped-CSS seam (currently emits nothing) |
| `src/shared/utils.ts` | Upstream-derived | SSR/DOM paths removed; behavioural allowlist: `staticMarker` consumption, `reservedNameSpaces` collapsing, `transformCondition` value semantics, `getNumberedId` reserved-word skip list. Additions moved to `src/lynx-utils.ts` |
| `src/shared/transform.ts` | Upstream-derived | Multi-renderer dispatch removed; adds a `DOMWithState` pre-scan + empty guard |
| `src/shared/component.ts` | Upstream-derived | Ref arrays / `applyRef` + empty-children guard |
| `src/shared/fragment.ts` | Upstream-derived | One extra empty guard |
| `src/shared/postprocess.ts` | Upstream-derived | Delegation/validate removed; extracts `lynxTemplates` / `lynxWorklets` metadata |
| `src/shared/preprocess.ts` | Verbatim (semantically) | TypeScript conversion only |
| `src/external.d.ts` | Upstream-derived | One extra type declaration |

## Build outputs

The same TypeScript sources produce two builds (identical externals:
`@babel/helper-module-imports`, `@babel/plugin-syntax-jsx`, `@babel/types`,
`html-entities`):

```bash
# published copy -> dist/jsx-lynx.cjs (part of `nub run build`)
nubx rslib build
# in-repo copy -> babel-plugin-jsx-lynx/dist/index.cjs (used by tests and dev)
nub run build:fork-plugin
```
