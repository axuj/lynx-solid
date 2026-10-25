/**
 * Skeleton-module emission tests: `renderSkeletonModuleLynx` output must be
 * directly evaluatable — multi-template files included. Regressions covered:
 * 1. missing statement terminators once fused consecutive registrations into
 *    a single call chain (`register(...)(...)`), throwing
 *    `... is not a function` on web for every multi-template entry;
 * 2. the registration must go through the statically imported
 *    `registerSkeleton` — a bare-global form silently no-ops (blank render,
 *    zero errors) whenever module/chunk order leaves the global install
 *    running after the skeleton body.
 */

import type { LynxExtractedTemplate } from '../../packages/compiler/src/types'
import { describe, expect, it } from 'vitest'
import { renderSkeletonModuleLynx } from '../../packages/plugin/src/skeleton-loader'

const CREATE = 'function(P, H, S) { return P.create("view") }'

function fakeTemplates(): LynxExtractedTemplate[] {
  return [
    { id: 111, createCode: CREATE, nodeCount: 1, anchors: [] },
    { id: 222, createCode: CREATE, nodeCount: 1, anchors: [{ index: 0, offset: 0 }] },
  ]
}

/**
 * Evaluate the emitted body (minus the registry import) with an explicit
 * `registerSkeleton` binding — mirroring what the static import provides
 * after bundling.
 */
function evalBody(src: string, registerSkeleton: (...args: unknown[]) => void): void {
  const body = src.split('\n').filter(line => !line.startsWith('import ')).join('\n')
  new Function('registerSkeleton', body)(registerSkeleton) // eslint-disable-line no-new-func
}

describe('renderSkeletonModuleLynx', () => {
  it('evaluates multi-template output: every template registers, no throw', () => {
    const seen: Array<[unknown, unknown]> = []
    evalBody(
      renderSkeletonModuleLynx(fakeTemplates(), './registry'),
      (id: unknown, create: unknown) => { seen.push([id, typeof create]) },
    )
    expect(seen).toEqual([[111, 'function'], [222, 'function']])
  })

  it('registers through the import binding, not a global (no silent noop)', () => {
    const src = renderSkeletonModuleLynx(fakeTemplates(), './registry')
    expect(src).toContain('import { registerSkeleton }')
    expect(src).not.toContain('__lynxSolidRegisterElementTemplate')
    expect(src).not.toContain('function () {}')
  })
})
