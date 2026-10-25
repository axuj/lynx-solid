import { beforeEach, describe, expect, it } from 'vitest'
import {
  hasSkeleton,
  registerSkeleton,
  resetSkeletonState,
} from '../../packages/runtime/src/main-thread/skeleton-registry'

describe('skeleton registration', () => {
  beforeEach(() => {
    resetSkeletonState()
  })

  it('stores create and reports presence', () => {
    const create = (() => {}) as never
    registerSkeleton(777, create)
    expect(hasSkeleton(777)).toBe(true)
    expect(hasSkeleton(778)).toBe(false)
  })

  it('reset clears registrations', () => {
    const create = (() => {}) as never
    registerSkeleton(777, create)
    resetSkeletonState()
    expect(hasSkeleton(777)).toBe(false)
  })
})
