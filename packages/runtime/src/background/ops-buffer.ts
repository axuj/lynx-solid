/**
 * Flat ops buffer: accumulates ops produced by a render pass so the whole
 * batch can be shipped to the Main Thread in one cross-thread call.
 *
 * Frames are appended through an arity-specific pusher rather than
 * `pushOp(...frame)`: a rest parameter allocates an arguments array per call
 * and spreading it back out again is the single biggest cost of *recording* a
 * first screen — and the MT-IFR direct sink records every frame so the
 * reconcile can compare it against the Background's. Callers know their own
 * arity (the sink has one method per op), so the arms go positionally and each
 * append is one `Array#push` with no allocation. `undefined` is a legal arm;
 * only the length of the argument list decides the frame size.
 *
 * Batch-window holds (RELEASE/REMOVE_EVENT deferred to drain) live in
 * batch-teardown.ts — this module is deliberately hold-free.
 */

let buffer: unknown[] = []

/** `[code]` */
export function push1(code: number): void {
  buffer.push(code)
}

/** `[code, a]` */
export function push2(code: number, a: unknown): void {
  buffer.push(code, a)
}

/** `[code, a, b]` */
export function push3(code: number, a: unknown, b: unknown): void {
  buffer.push(code, a, b)
}

/** `[code, a, b, c]` */
export function push4(code: number, a: unknown, b: unknown, c: unknown): void {
  buffer.push(code, a, b, c)
}

/** `[code, a, b, c, d]` */
export function push5(code: number, a: unknown, b: unknown, c: unknown, d: unknown): void {
  buffer.push(code, a, b, c, d)
}

/**
 * Append one frame from an already-built argument list — the convenience form
 * for tests and tooling, which build frames by hand.
 *
 * The frame path does NOT use this: a rest parameter allocates an arguments
 * array per call and spreading it back out is the biggest cost of recording a
 * first screen, so the sink appends through the arity-specific pushers above
 * (see the module header).
 */
export function pushOp(...frame: unknown[]): void {
  buffer.push(...frame)
}

/** Drain the batch and reset the buffer. */
export function takeOps(): unknown[] {
  const ops = buffer
  buffer = []
  return ops
}

/** Reset module state – for testing only. */
export function resetOpsBuffer(): void {
  buffer = []
}
