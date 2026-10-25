/**
 * Hydrate diff: the MT's first screen against the Background's first batch.
 *
 * Both streams describe the same thing — what each thread's render of the same
 * program wants the tree to be — and the MT's stream IS the tree it painted,
 * frame for frame. So the reconcile is not "compare bytes" but "reuse the tree
 * and apply only what differs":
 *
 *   - identical frames            → nothing to do (the common case);
 *   - same identity, other value  → apply the Background's frame (in place);
 *   - anything else               → divergence: the caller repaints (today's
 *                                    path, still correct — just expensive).
 *
 * That middle case is the point. Without it any difference costs a full
 * teardown plus the Background's whole batch on the Main Thread — the IFR
 * path then pays its first-screen render *and* the replay, which is worse than
 * not doing IFR. One changed label used to buy exactly that; with the diff it
 * costs one SET_PROP.
 *
 * ## Identity vs value
 *
 * A frame is *value* when its arguments are a value the renderer chose
 * (SET_PROP/SET_TEXT/SET_CLASS/SET_ID/SET_STYLE) and *identity* when they
 * describe structure or wiring (CREATE/CREATE_TEXT/INSERT/REMOVE/INSTANTIATE/
 * RELEASE and every event/ref frame). Identity frames must match exactly or the
 * diff bails out: patching one would mean mutating a tree the Background did not
 * describe, and a mis-resolved id is exactly the corruption this whole
 * mechanism exists to avoid.
 *
 * Event and ref frames stay identity-only on purpose — their `sign`/`_execId`
 * values are per-thread registry state, and the MT's teardown bookkeeping
 * (`elementEventSigns`, `worklet-apply`) is keyed by what IT registered. They
 * match frame for frame when the two renders agree (same program, same data),
 * which is the case this optimises; when they do not, repainting is the honest
 * answer.
 *
 * The walk is lockstep on purpose: the two renderers run the same program from
 * the same initial state, so the frame *kinds* and their order are determined by
 * the program, not by the data. A kind mismatch therefore means a real
 * structural divergence — not a resync opportunity.
 */

import { OP, OP_ARITY } from '../internal/ops'

/**
 * Frames whose arguments are a repaintable value. `key`/`id` still have to
 * match (see {@link identityMatches}) — only the value slot may differ.
 */
function isValueFrame(code: number): boolean {
  return (
    code === OP.SET_PROP
    || code === OP.SET_TEXT
    || code === OP.SET_CLASS
    || code === OP.SET_ID
    || code === OP.SET_STYLE
  )
}

export type HydrateResult
  = | { kind: 'match' }
    | { kind: 'patch', ops: unknown[] }
    | { kind: 'diverge', cause: string, index: number }

/** First index at which two frame arrays part ways – dev diagnostics only. */
function indexOf(a: unknown[], b: unknown[], i: number, j: number): number {
  return i < j ? i : j
}

/**
 * Whether the two frames address the same thing. Value frames compare every
 * argument but their value slot; identity frames compare all of them.
 */
function identityMatches(
  code: number,
  painted: unknown[],
  i: number,
  incoming: unknown[],
  j: number,
): boolean {
  switch (code) {
    case OP.SET_PROP:
      return painted[i + 1] === incoming[j + 1] && painted[i + 2] === incoming[j + 2]
    case OP.SET_TEXT:
    case OP.SET_CLASS:
    case OP.SET_ID:
    case OP.SET_STYLE:
      return painted[i + 1] === incoming[j + 1]
    default:
      return argsEqual(painted, i, incoming, j, (OP_ARITY as Record<number, number>)[code] ?? 0)
  }
}

/** Value equality for the arms of a frame. Primitives are the 99% case. */
function argsEqual(
  a: unknown[],
  i: number,
  b: unknown[],
  j: number,
  arity: number,
): boolean {
  for (let k = 1; k <= arity; k++) {
    const av = a[i + k]
    const bv = b[j + k]
    if (av === bv)
      continue
    if (typeof av === 'object' && typeof bv === 'object' && av !== null && bv !== null) {
      // Object arms (INSTANTIATE diffs, SET_STYLE objects, worklet payloads)
      // are rare and tiny — one canonical stringify each.
      if (JSON.stringify(av) !== JSON.stringify(bv))
        return false
      continue
    }
    return false
  }
  return true
}

/**
 * Diff the Background's first batch against the stream the Main Thread
 * painted. Never mutates either input.
 */
export function hydrateDiff(painted: unknown[], incoming: unknown[]): HydrateResult {
  const patch: unknown[] = []
  const arityTable = OP_ARITY as Record<number, number>
  let i = 0
  let j = 0

  while (i < painted.length && j < incoming.length) {
    const paintedCode = painted[i] as number
    const incomingCode = incoming[j] as number
    if (paintedCode !== incomingCode)
      return { kind: 'diverge', cause: 'frame-kind', index: indexOf(painted, incoming, i, j) }

    const arity = arityTable[paintedCode]
    if (arity === undefined)
      return { kind: 'diverge', cause: 'unknown-op', index: i }

    if (!identityMatches(paintedCode, painted, i, incoming, j))
      return { kind: 'diverge', cause: 'identity', index: indexOf(painted, incoming, i, j) }

    if (isValueFrame(paintedCode) && !argsEqual(painted, i, incoming, j, arity))
      patch.push(...incoming.slice(j, j + arity + 1))

    i += arity + 1
    j += arity + 1
  }

  if (i !== painted.length || j !== incoming.length)
    return { kind: 'diverge', cause: 'length', index: indexOf(painted, incoming, i, j) }

  return patch.length > 0 ? { kind: 'patch', ops: patch } : { kind: 'match' }
}
