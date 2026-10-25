import type { AnimationHandle, TweenOptions } from './motion'
/**
 * Adapters barrel — the single import path for case files.
 *
 * A case marks exactly one root edge into the shared graph:
 * `import { … } from '../adapters' with { runtime: 'shared' }`. The root
 * mark drops this barrel onto the shared layer, and the cascade rule
 * follows every module it imports onto the same layer — so `./motion` and
 * the `motion-dom` package ride the shared pipeline with full exports on
 * MT (no source rewriting anywhere in the chain).
 *
 * Same rule as `./motion`: this file value-imports `motion-dom`, so it
 * bare side-effect-imports the gate first — Plan B freezes that line in
 * place (the cascade marks that edge too, its importer is already on the
 * layer), so the gate evaluates before `motion-dom` snapshots the facades.
 *
 * Re-export shape is free: the cascade matches every runtime edge out of
 * a shared-layer module — `import … from`, bare side-effect and
 * `export … from` alike — so barrels need no import-then-export dance.
 *
 * `styleEffect` resolves to the `./motion` wrapper (subjects cross through
 * ElementCompt first); the raw motion-dom `styleEffect` is deliberately
 * not re-exported here.
 */
import './shim-entry'

export {
  animateEl,
  animateMv,
  calcProgress,
  clampN,
  colorMixer,
  springValueTo,
  styleEffect,
  tween,
} from './motion'
export { animateElement, animateValue, mapValue, mix, motionValue, transformValue } from 'motion-dom'
export type { AnimationHandle, TweenOptions }
