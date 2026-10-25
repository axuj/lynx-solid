export const SHEET_GESTURE_LOCK_DISTANCE = 8
export const SHEET_RUBBER_LIMIT = 80
export const SHEET_FLING_MIN_DISTANCE = 24
export const SHEET_FLING_MIN_VELOCITY = 200
export const SHEET_FLING_DECELERATION = 2000

export type SheetGestureSource = 'handle' | 'content'

export interface SheetSpringState {
  value: number
  velocity: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function shouldClaimSheetGesture(
  source: SheetGestureSource,
  deltaX: number,
  deltaY: number,
  scrollTop: number,
): boolean {
  // Compare squared distance to avoid Math.sqrt on every touchmove sample.
  if (deltaX * deltaX + deltaY * deltaY < SHEET_GESTURE_LOCK_DISTANCE * SHEET_GESTURE_LOCK_DISTANCE)
    return false

  if (Math.abs(deltaY) <= Math.abs(deltaX))
    return false

  return source === 'handle' || (deltaY > 0 && scrollTop <= 0)
}

export function rubberEffect(original: number, max: number, coeff = 0.5): number {
  if (original === 0 || max <= 0)
    return 0

  return (1 - 1 / ((Math.abs(original) * coeff) / max + 1)) * max
}

export function resolveSheetDrag(
  deltaY: number,
  rubberMax = 80,
  coeff = 0.5,
): number {
  return deltaY >= 0 ? deltaY : -rubberEffect(deltaY, rubberMax, coeff)
}

export function sheetOpenProgress(distance: number, sheetSize: number): number {
  if (sheetSize <= 0)
    return 1

  return clamp(1 - Math.max(0, distance) / sheetSize, 0, 1)
}

export function smoothSheetVelocity(
  previousVelocity: number,
  distanceDelta: number,
  deltaMs: number,
  blend = 0.25,
): number {
  if (deltaMs <= 0)
    return previousVelocity

  const sampleVelocity = distanceDelta / deltaMs * 1000
  const sampleWeight = clamp(blend, 0, 1)
  return previousVelocity * (1 - sampleWeight) + sampleVelocity * sampleWeight
}

export function sheetReleaseVelocity(
  velocity: number,
  sampleAgeMs: number,
  maximumAgeMs = 80,
): number {
  if (sampleAgeMs < 0 || sampleAgeMs > maximumAgeMs)
    return 0

  return velocity
}

export function projectSheetRelease(
  distance: number,
  velocity: number,
  deceleration = 2000,
): number {
  if (velocity <= 0 || deceleration <= 0)
    return distance

  return distance + velocity * velocity / (2 * deceleration)
}

export function sheetDismissThreshold(
  sheetSize: number,
  fixedDistance = 0,
): number {
  if (fixedDistance > 0)
    return fixedDistance

  return sheetSize > 0 ? sheetSize * 0.15 : 120
}

export function shouldDismissSheet(
  distance: number,
  velocity = 0,
  threshold = 120,
  minimumFlingDistance = 24,
  minimumFlingVelocity = 200,
): boolean {
  if (distance >= threshold)
    return true

  if (distance < minimumFlingDistance || velocity < minimumFlingVelocity)
    return false

  return projectSheetRelease(distance, velocity) >= threshold
}

export function stepSheetSpring(
  value: number,
  velocity: number,
  target: number,
  deltaSeconds: number,
  stiffness = 300,
  damping = 30,
): SheetSpringState {
  const safeDelta = clamp(deltaSeconds, 0, 1 / 30)
  const acceleration = -stiffness * (value - target) - damping * velocity
  const nextVelocity = velocity + acceleration * safeDelta
  return {
    value: value + nextVelocity * safeDelta,
    velocity: nextVelocity,
  }
}
