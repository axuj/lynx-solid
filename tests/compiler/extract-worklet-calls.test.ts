/**
 * extractWorkletCalls / extractSingleWorkletCall — pull verbatim worklet
 * registration calls out of SWC output text
 * (`registerWorklet[Internal]("type", "id", fn)` plus optional prefixes
 * like `__workletRuntimeLoaded && ...`).
 *
 * Anchored on the registration call with balanced-paren scanning (same
 * technique as vue's `extractRegistrations`) — never on the `'function'`
 * keyword, which also matches string literals, comments and ids. Slicing
 * starts AT the marker, so guard prefixes are naturally dropped; the call
 * goes out untouched (both globals are the same function in the official
 * runtime — no peeling, no re-emit).
 */

import { describe, expect, it } from 'vitest'
import { extractSingleWorkletCall, extractWorkletCalls } from '../../packages/compiler/src/worklet-utils'

const FN = 'function(e) { return e; }'

describe('extractWorkletCalls', () => {
  it('extracts the verbatim call, dropping guard prefixes', () => {
    const calls = extractWorkletCalls(
      'const __workletRuntimeLoaded = loadWorkletRuntime(undefined);\n'
      + '__workletRuntimeLoaded && registerWorkletInternal("main-thread", "d3dd:1", function(e) {\n'
      + '  return e;\n'
      + '});\n',
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe('d3dd:1')
    expect(calls[0].call).toBe(
      'registerWorkletInternal("main-thread", "d3dd:1", function(e) {\n  return e;\n});',
    )
  })

  it('accepts the public-name variant', () => {
    const calls = extractWorkletCalls(
      `registerWorklet("main-thread", "b09a:1", ${FN});`,
    )
    expect(calls).toEqual([
      { id: 'b09a:1', call: `registerWorklet("main-thread", "b09a:1", ${FN});` },
    ])
  })

  it('extracts every call in multi-call text', () => {
    const calls = extractWorkletCalls(
      `registerWorklet("main-thread", "a:1", ${FN});\n`
      + `registerWorkletInternal("main-thread", "b:2", ${FN});\n`,
    )
    expect(calls.map(c => c.id)).toEqual(['a:1', 'b:2'])
  })

  it('ignores the word function inside strings and comments', () => {
    const calls = extractWorkletCalls(
      '// a function comment\n'
      + 'registerWorklet("main-thread", "b09a:1", function(e) { return "function"; });',
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].call).toContain('return "function";')
  })

  it('skips unbalanced calls rather than mis-cutting', () => {
    expect(
      extractWorkletCalls('registerWorklet("main-thread", "b09a:1", function(e) {'),
    ).toEqual([])
  })

  it('returns [] with no marker', () => {
    expect(extractWorkletCalls('const x = 1;')).toEqual([])
  })
})

describe('extractSingleWorkletCall', () => {
  it('returns the single call', () => {
    expect(
      extractSingleWorkletCall(`registerWorklet("main-thread", "b09a:1", ${FN});`),
    ).toBe(`registerWorklet("main-thread", "b09a:1", ${FN});`)
  })

  it('returns null unless exactly one well-formed call', () => {
    expect(extractSingleWorkletCall('const x = 1;')).toBeNull()
    expect(extractSingleWorkletCall(`registerWorklet("a", "b", ${FN});\nregisterWorklet("c", "d", ${FN});`)).toBeNull()
    expect(extractSingleWorkletCall('registerWorklet("main-thread", "b09a:1", function(e) {')).toBeNull()
  })
})
