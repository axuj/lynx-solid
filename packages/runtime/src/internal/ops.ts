/**
 * Flat-array operation codes — the wire protocol between the Background
 * Thread (renderer) and the Main Thread (engine / wasm).
 *
 * Format (all numbers/strings, JSON-serializable):
 *   CREATE_PAGE:     [0]                      (page root, id=1; reserved — the
 *                      BG renderer creates the root directly, never emits it)
 *   CREATE:          [1, id, type]
 *   CREATE_TEXT:     [2, id]
 *   INSERT:          [3, parentId, childId, anchorId]  anchorId=-1 means append
 *   REMOVE:          [4, parentId, childId]
 *   SET_PROP:        [5, id, key, value]
 *   SET_TEXT:        [6, id, text]
 *   SET_EVENT:       [7, id, eventType, eventName, sign]
 *   REMOVE_EVENT:    [8, id, eventType, eventName]
 *   SET_STYLE:       [12, id, style]             full replacement via __SetInlineStyles
 *   SET_CLASS:       [10, id, classString]
 *   SET_ID:          [11, id, idString]
 *   INSTANTIATE:     [14, templateId, diffs, firstId]  clone the template
 *                      into real elements and fill dynamic slots; event
 *                      slots carry the BG-side sign. Node ids are the BG
 *                      expansion's consecutive run [firstId, firstId + n)
 *                      (n = template node count): node i gets firstId + i,
 *                      derived from the frame — the same program-offset
 *                      scheme octane uses for mount-template-range
 *   MT_SET_EVENT:    [15, id, eventType, eventName, payload]  main-thread
 *                      worklet event binding. eventType travels untouched
 *                      (bindEvent/catchEvent — folding catch into bind breaks
 *                      propagation contracts). payload = { _wkltId, _c }
 *                      (null removes) — the worklet id (handler body
 *                      registered on the MT at compile time) plus the captured
 *                      free variables; the engine routes the event to the
 *                      worklet natively
 *   INIT_MT_REF:     [16, wvid, initValue]  register a main-thread ref value
 *   SET_MT_REF:      [17, id, wvid]  bind a main-thread ref to an element
 *                      (wvid = -1 unbinds)
 */
export const OP = {
  CREATE_PAGE: 0,
  CREATE: 1,
  CREATE_TEXT: 2,
  INSERT: 3,
  REMOVE: 4,
  SET_PROP: 5,
  SET_TEXT: 6,
  SET_EVENT: 7,
  REMOVE_EVENT: 8,
  SET_CLASS: 10,
  SET_ID: 11,
  SET_STYLE: 12,
  INSTANTIATE: 14,
  MT_SET_EVENT: 15,
  INIT_MT_REF: 16,
  SET_MT_REF: 17,
  RELEASE: 18,
} as const

export type OpCode = (typeof OP)[keyof typeof OP]

/**
 * Number of arguments following each opcode in the flat ops array. Consumers
 * that walk op streams without dispatching (tests, tooling) rely on this
 * table; keep it in lockstep when adding an op.
 */
export const OP_ARITY = {
  [OP.CREATE_PAGE]: 0,
  [OP.CREATE]: 2, // id, type
  [OP.CREATE_TEXT]: 1, // id
  [OP.INSERT]: 3, // parentId, childId, anchorId
  [OP.REMOVE]: 2, // parentId, childId
  [OP.SET_PROP]: 3, // id, key, value
  [OP.SET_TEXT]: 2, // id, text
  [OP.SET_EVENT]: 4, // id, eventType, eventName, sign
  [OP.REMOVE_EVENT]: 3, // id, eventType, eventName
  [OP.SET_STYLE]: 2, // id, style (full)
  [OP.SET_CLASS]: 2, // id, classString
  [OP.SET_ID]: 2, // id, idString
  [OP.INSTANTIATE]: 3, // templateId, diffs, firstId
  [OP.MT_SET_EVENT]: 4, // id, eventType, eventName, payload ({ code, refs } | null)
  [OP.INIT_MT_REF]: 2, // wvid, initValue
  [OP.SET_MT_REF]: 2, // id, wvid (-1 unbinds)
  [OP.RELEASE]: 2, // firstId, count — drop MT id mappings for [firstId, firstId+count)
} as const

/**
 * Wire args for each opcode — source of truth for the B plan typed
 * reader. SET_ID is `string | null` (official `__SetID` signature); BG
 * normalizes `undefined` → `null` at push time, so the MT never sees
 * `undefined` and the `idStr ?? null` dance disappears.
 */
export interface OpMap {
  [OP.CREATE_PAGE]: []
  [OP.CREATE]: [id: number, type: string]
  [OP.CREATE_TEXT]: [id: number]
  [OP.INSERT]: [parentId: number, childId: number, anchorId: number]
  [OP.REMOVE]: [parentId: number, childId: number]
  [OP.SET_PROP]: [id: number, key: string, value: unknown]
  [OP.SET_TEXT]: [id: number, text: string]
  [OP.SET_EVENT]: [id: number, eventType: string, eventName: string, sign: string]
  [OP.REMOVE_EVENT]: [id: number, eventType: string, eventName: string]
  [OP.SET_STYLE]: [id: number, style: string | Record<string, unknown> | null]
  [OP.SET_CLASS]: [id: number, className: string]
  [OP.SET_ID]: [id: number, idStr: string | null]
  [OP.INSTANTIATE]: [templateId: number, diffs: unknown[], firstId: number]
  [OP.MT_SET_EVENT]: [id: number, eventType: string, eventName: string, payload: Record<string, unknown> | null]
  [OP.INIT_MT_REF]: [wvid: number, initValue: unknown]
  [OP.SET_MT_REF]: [id: number, wvid: number]
  /**
   * BG unmount release: the node (or template instance range) is dead —
   * the MT drops its id→element mapping so long sessions don't accumulate
   * one entry per row ever created. REMOVE keeps the mapping (keyed-list
   * revive contract); RELEASE only fires from the destroy path, after the
   * subtree REMOVE, so any later INSERT of a released id is an engine-level
   * bug and degrades to the existing "unknown id" skip — never a crash.
   */
  [OP.RELEASE]: [firstId: number, count: number]
}

export type Op = {
  [K in OpCode]: [K, ...OpMap[K]]
}[OpCode]

/** Typed slice reader for the flat ops array — B plan, zero wire cost. */
export function readOp<K extends OpCode>(code: K, ops: unknown[], i: number): OpMap[K] {
  return ops.slice(i, i + OP_ARITY[code]) as OpMap[K]
}

/** Generator that yields typed `Op` tuples and advances internally — hides `i += OP_ARITY` per case. */
export function* iterOps(ops: unknown[]): Generator<Op> {
  let i = 0
  while (i < ops.length) {
    const code = ops[i++] as OpCode
    const arity = (OP_ARITY as Record<number, number>)[code]
    if (arity === undefined)
      break
    const args = ops.slice(i, i + arity) as OpMap[typeof code]
    i += arity
    yield [code, ...args] as Op
  }
}

/**
 * The element id both threads assign to the page root. The BG renderer's
 * ShadowElement id space and the MT element registry must agree on it.
 */
export const PAGE_ROOT_ID = 1
