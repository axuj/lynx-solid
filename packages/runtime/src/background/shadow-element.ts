/**
 * ShadowElement: a lightweight doubly-linked tree node living entirely on the
 * Background Thread. It exists for one reason: Solid's dynamic reconcile
 * (insertExpression/reconcileArrays — Show swaps, For keyed moves) needs to
 * walk siblings to locate markers, and ids alone carry no order. Real Lynx
 * elements live on the Main Thread; element IDs align both sides.
 *
 * id=1 is reserved for the page root. Regular elements start from id=2.
 */

/**
 * Sentinel `id` for a node that has not been given one yet. Only lazily
 * created empty `#text` nodes carry it: they own no MT element and emit no
 * op, so consuming a counter slot for them is pure waste — and worse, the
 * waste is not symmetric across Solid builds. The server build inserts
 * placeholder text nodes at different positions than the client build (same
 * count, different order), so every id burned by an invisible node shifts
 * all later ids and makes two otherwise-identical renders disagree — the
 * MT-IFR first screen would tear down and repaint on every page.
 *
 * `0` is safe as a sentinel: real ids start at 2 (1 is the page root) and
 * BG-only markers are negative.
 */
export const DEFERRED_ID = 0

export class ShadowElement {
  static nextId = 2 // 1 is reserved for the page root

  /** `DEFERRED_ID` until {@link materializeId} runs; see the constant. */
  id: number
  type: string
  parent: ShadowElement | null = null
  firstChild: ShadowElement | null = null
  lastChild: ShadowElement | null = null
  prev: ShadowElement | null = null
  next: ShadowElement | null = null

  /** Event signs registered on this element (for unregister on remove). */
  eventSigns: Set<string> | undefined

  /**
   * MT materialization state for lazily-created text nodes: empty text owns
   * no MT element until it holds visible text (mirrors vue-lynx). Meaningful
   * for `#text` only — every other type is always materialized.
   */
  mtCreated?: boolean
  mtInserted?: boolean

  /**
   * Template instance marker (set by lynx-template): lets insert() report
   * the owning template in failure diagnostics. `nodeCount` mirrors the
   * reserved id run [firstId, firstId+nodeCount) — RELEASE drops the whole
   * skeleton range when the instance dies.
   */
  templateRef: { id: number, diffs: unknown[], firstId: number, nodeCount: number } | null = null

  /**
   * Template-instance roots only (assigned by lynx-template's Object.assign):
   * lazy id-carrier cells, deliberately never linked into any BG list (see
   * LynxTemplateInstance). Dynamic children materialized under those cells —
   * notably raw-text with ids OUTSIDE the reserved range — hang here, so any
   * walk that must see every node owning an MT id (dying collection, sign
   * collection) has to descend this map in addition to firstChild chains;
   * walking only the chains misses them and leaks the whole detached subtree
   * on the MT (elements[] entries pinning detached DOM — the sustained-bench
   * ~4.7MB/1k-row growth).
   */
  staticCache?: Map<number, ShadowElement>

  constructor(type: string, forceId?: number) {
    if (forceId === undefined) {
      this.id = ShadowElement.nextId++
    }
    else {
      this.id = forceId
    }
    this.type = type
  }

  /**
   * Assign an id on first use and return it. Idempotent: a node that already
   * owns an id (constructed normally, or materialized earlier) returns it
   * unchanged. Called from the one place a deferred `#text` node becomes
   * real — `replaceText`'s first non-empty fill.
   */
  materializeId(): number {
    if (this.id === DEFERRED_ID)
      this.id = ShadowElement.nextId++
    return this.id
  }

  /** Whether this node still has no id. */
  get isDeferred(): boolean {
    return this.id === DEFERRED_ID
  }

  appendChild(child: ShadowElement): void {
    if (child.parent) {
      child.parent.removeChild(child)
    }
    child.parent = this
    child.prev = this.lastChild
    child.next = null
    if (this.lastChild) {
      this.lastChild.next = child
    }
    else {
      this.firstChild = child
    }
    this.lastChild = child
  }

  insertBefore(child: ShadowElement, anchor: ShadowElement | null): void {
    if (child.parent) {
      child.parent.removeChild(child)
    }
    child.parent = this

    if (!anchor) {
      child.prev = this.lastChild
      child.next = null
      if (this.lastChild) {
        this.lastChild.next = child
      }
      else {
        this.firstChild = child
      }
      this.lastChild = child
      return
    }

    child.prev = anchor.prev
    child.next = anchor
    if (anchor.prev) {
      anchor.prev.next = child
    }
    else if (this.firstChild === null || anchor === this.firstChild) {
      this.firstChild = child
    }
    else {
      // Unlinked anchor (a static id-carrier, parent === null) with a
      // non-empty chain: dynamics splice in document order, so place the
      // child at the tail. `firstChild = child` here would orphan every
      // node already spliced (walkSubtree would then never see them —
      // no RELEASE, no sign collection: the cell-as-anchor leak).
      let t = this.firstChild
      while (t.next)
        t = t.next
      t.next = child
      child.prev = t
    }
    anchor.prev = child
    if (this.lastChild === null && this.firstChild !== null) {
      // A splice never touches lastChild — with an unlinked anchor the new
      // chain can end at the anchor itself; keep the tail honest so a later
      // appendChild chains off it instead of re-arming firstChild.
      let t = this.firstChild
      while (t.next)
        t = t.next
      this.lastChild = t
    }
  }

  removeChild(child: ShadowElement): void {
    if (child.parent !== this)
      return
    if (child.prev) {
      child.prev.next = child.next
    }
    else {
      this.firstChild = child.next
    }
    if (child.next) {
      child.next.prev = child.prev
    }
    else {
      this.lastChild = child.prev
    }
    child.parent = null
    child.prev = null
    child.next = null
  }
}

/**
 * Marker nodes (`#marker`) are BG-only insertion anchors for dynamic slots
 * with no static sibling after them — the Lynx substitute for DOM `<!>`
 * comments (mirrors vue-lynx `#comment`). They never cross to the Main
 * Thread: no CREATE/INSERT/REMOVE op references them, so their ids live
 * outside the BG/MT shared id space (negative, never -1 which means
 * "append" on the wire).
 */
export const MARKER_ID_BASE = -2

/**
 * Whether the node owns a Main Thread element. BG-only slot markers never
 * do; lazily materialized text does only while non-empty (empty text —
 * off-state slots, the universal sentinel — stays a pure BG anchor).
 * Everything else ships verbatim, exactly as before.
 */
export function isMaterialized(node: ShadowElement): boolean {
  if (node.type === '#marker')
    return false
  if (node.type === '#text')
    return node.mtCreated === true
  return true
}

/**
 * Walk forward past BG-only anchors to the next materialized sibling (or
 * null when the marker trails). The MT INSERT then targets a real element
 * id, or appends — mirrors vue-lynx `resolveMainThreadAnchor`.
 */
export function resolveAnchor(anchor: ShadowElement | null | undefined): ShadowElement | null {
  let resolved = anchor ?? null
  while (resolved && !isMaterialized(resolved))
    resolved = resolved.next
  return resolved
}

export function collectSubtreeSigns(node: ShadowElement): string[] {
  const signs: string[] = []
  const visit = (n: ShadowElement) => {
    if (n.eventSigns) {
      for (const s of n.eventSigns) signs.push(s)
    }
  }
  walkSubtree(node, visit)
  return signs
}

/**
 * Pre-order walk over every node the subtree owns: firstChild chains PLUS
 * each visited instance root's staticCache cells (and their chains — the
 * unlinked id-carriers where dynamic children of template cells live; see
 * ShadowElement.staticCache). Used by dying-id and sign collection, which
 * must see exactly the nodes that can own MT entries.
 */
export function walkSubtree(node: ShadowElement, visit: (n: ShadowElement) => void): void {
  const walk = (n: ShadowElement): void => {
    visit(n)
    let c = n.firstChild
    while (c) {
      walk(c)
      c = c.next
    }
    if (n.staticCache) {
      for (const cell of n.staticCache.values())
        walk(cell)
    }
  }
  walk(node)
}

export function resetShadowState(): void {
  ShadowElement.nextId = 2
}
