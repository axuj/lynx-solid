/**
 * IFR runtime aliases: everything IFR-related must come from ONE build tree.
 *
 * On device the MT bundle used to end up with two copies of the runtime — the
 * bare specifier aliased into `dist/`, while the compiler-emitted
 * `…/lynx-template` subpath was answered by the package exports map from `src/`
 * — and rspack treats those as different modules. Nothing threw: the MT
 * rendered a whole first screen into a copy whose ops buffer nobody read, the
 * recording kept a single stray frame, every reconcile diverged and the screen
 * was torn down and replayed from the Background. These tests pin the invariant
 * that makes the duplicate impossible.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ifrRuntimeAliases,
  RUNTIME_SPECIFIER,
  TEMPLATE_SPECIFIER,
} from '../../packages/plugin/src/ifr-alias'

let roots: string[] = []

/** A fake runtime package with the `src/` and `dist/` trees side by side. */
function fakeRuntime(): { src: string, dist: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'ifr-alias-'))
  roots.push(root)
  for (const tree of ['src', 'dist']) {
    const ext = tree === 'src' ? 'ts' : 'js'
    mkdirSync(path.join(root, tree, 'main-thread'), { recursive: true })
    mkdirSync(path.join(root, tree, 'background'), { recursive: true })
    writeFileSync(path.join(root, tree, 'main-thread', `index.${ext}`), '')
    writeFileSync(path.join(root, tree, 'main-thread', `ifr-runtime.${ext}`), '')
    writeFileSync(path.join(root, tree, 'background', `lynx-template.${ext}`), '')
  }
  return { src: path.join(root, 'src'), dist: path.join(root, 'dist') }
}

/** `<tree>/<subdir>/<file>` — the tree is what must be shared, not the file. */
function treeOf(file: string): string {
  return path.dirname(path.dirname(file))
}

afterEach(() => {
  for (const root of roots)
    rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('ifrRuntimeAliases', () => {
  it('pins the template subpath into the dist tree of a dist entry', () => {
    const { dist } = fakeRuntime()
    const aliases = ifrRuntimeAliases(path.join(dist, 'main-thread', 'index.js'))

    expect(aliases[RUNTIME_SPECIFIER]).toBe(path.join(dist, 'main-thread', 'ifr-runtime.js'))
    expect(aliases[TEMPLATE_SPECIFIER]).toBe(path.join(dist, 'background', 'lynx-template.js'))
    expect(treeOf(aliases[RUNTIME_SPECIFIER]!)).toBe(treeOf(aliases[TEMPLATE_SPECIFIER]!))
  })

  it('pins the template subpath into the src tree of a src entry', () => {
    const { src } = fakeRuntime()
    const aliases = ifrRuntimeAliases(path.join(src, 'main-thread', 'index.ts'))

    expect(aliases[RUNTIME_SPECIFIER]).toBe(path.join(src, 'main-thread', 'ifr-runtime.ts'))
    expect(aliases[TEMPLATE_SPECIFIER]).toBe(path.join(src, 'background', 'lynx-template.ts'))
    expect(treeOf(aliases[RUNTIME_SPECIFIER]!)).toBe(treeOf(aliases[TEMPLATE_SPECIFIER]!))
  })

  it('follows the entry tree even when a dist tree is also present', () => {
    // The entry decides the tree. Resolving the subpath independently is what
    // split the graph, and the split is invisible until a device run.
    const { src } = fakeRuntime()
    const aliases = ifrRuntimeAliases(path.join(src, 'main-thread', 'index.ts'))

    expect(treeOf(aliases[TEMPLATE_SPECIFIER]!)).toBe(src)
    expect(treeOf(aliases[RUNTIME_SPECIFIER]!)).toBe(src)
  })

  it('covers the compiler-emitted template specifier, not just the bare one', () => {
    const { dist } = fakeRuntime()
    const aliases = ifrRuntimeAliases(path.join(dist, 'main-thread', 'index.js'))

    expect(Object.keys(aliases).sort()).toEqual(
      [RUNTIME_SPECIFIER, TEMPLATE_SPECIFIER].sort(),
    )
  })
})
