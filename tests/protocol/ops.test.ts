import { describe, expect, it } from 'vitest'
import { OP, OP_ARITY, PAGE_ROOT_ID } from '../../packages/runtime/src/internal/ops'

describe('ops protocol', () => {
  it('keeps opcodes distinct and ordered', () => {
    const codes = Object.values(OP)
    expect(new Set(codes).size).toBe(codes.length)
    expect(Math.max(...codes)).toBeLessThan(19)
  })

  it('documents arity for every opcode', () => {
    for (const code of Object.values(OP)) {
      expect(typeof OP_ARITY[code as keyof typeof OP_ARITY]).toBe('number')
    }
  })

  it('reserves id 1 for the page root', () => {
    expect(PAGE_ROOT_ID).toBe(1)
  })
})
