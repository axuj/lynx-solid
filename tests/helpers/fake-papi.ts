/**
 * Fake Lynx PAPI environment for Main Thread tests: installs engine globals
 * (__CreateElement, __AppendElement, ...) as recording stubs operating on a
 * plain in-memory tree, so ops translation can be asserted without a real
 * engine.
 */

export interface FakeEl {
  uid: number
  type: string
  children: FakeEl[]
  parent: FakeEl | null
  attrs: Record<string, unknown>
  style: Record<string, string>
  events: { eventType: string, eventName: string, sign?: string }[]
  readonly firstChild: FakeEl | null
}

export interface FakePapiHost {
  root: FakeEl
  elements: FakeEl[]
  flushCount: number
  createCalls: { tag: string, parentId: number }[]
  invokeCalls: { uid: number, method: string, params: Record<string, unknown> }[]
  uidCounter: number
  listCallbacks: { componentAtIndex?: (...a: unknown[]) => unknown }[]
  /**
   * Strict anchor checks (default false). When true, __InsertElementBefore
   * with an anchor that is not a child of the parent throws instead of
   * appending — mirrors native strictness so order bugs can't hide.
   * List parents are excluded: list items live in the datasource, not in
   * children, so every list anchor would look "unknown" to this check.
   */
  strictAnchors: boolean
}

export function installFakePapi(): FakePapiHost {
  const host: FakePapiHost = {
    root: null as unknown as FakeEl,
    elements: [],
    flushCount: 0,
    createCalls: [],
    invokeCalls: [],
    uidCounter: 2,
    listCallbacks: [],
    strictAnchors: false,
  }

  const createEl = (type: string): FakeEl => ({
    uid: host.uidCounter++,
    type,
    children: [],
    parent: null,
    attrs: {},
    style: {},
    events: [],
    get firstChild() {
      return (this as FakeEl).children[0] ?? null
    },
  })

  // Engine mock — deliberately loose: fakes do not satisfy the strict
  // LynxElement surface; this file IS the stand-in for the engine.
  const g = globalThis as Record<string, unknown>

  g.__CreatePage = (_componentId: string, _cssId: number) => {
    host.root = {
      uid: 1,
      type: 'page',
      children: [],
      parent: null,
      attrs: {},
      style: {},
      events: [],
      get firstChild() {
        return host.root.children[0] ?? null
      },
    }
    host.elements.push(host.root)
    return host.root
  }
  g.__CreateElement = (tag: string, parentId: number) => {
    const el = createEl(tag)
    host.elements.push(el)
    host.createCalls.push({ tag, parentId })
    return el
  }
  g.__CreateView = (parentId: number) => {
    const el = createEl('view')
    host.elements.push(el)
    host.createCalls.push({ tag: 'view', parentId })
    return el
  }
  g.__CreateImage = (parentId: number) => {
    const el = createEl('image')
    host.elements.push(el)
    host.createCalls.push({ tag: 'image', parentId })
    return el
  }
  g.__CreateScrollView = (parentId: number) => {
    const el = createEl('scroll-view')
    host.elements.push(el)
    host.createCalls.push({ tag: 'scroll-view', parentId })
    return el
  }
  g.__CreateList = (parentId: number, componentAtIndex?: (...a: unknown[]) => unknown) => {
    const el = createEl('list')
    host.elements.push(el)
    host.createCalls.push({ tag: 'list', parentId })
    host.listCallbacks.push({ componentAtIndex })
    return el
  }
  g.__CreateText = (parentId: number) => {
    const el = createEl('text')
    host.elements.push(el)
    host.createCalls.push({ tag: 'text', parentId })
    return el
  }
  g.__CreateRawText = (s: string) => {
    const el = createEl('rawtext')
    // Engine SetText lands content as the text attribute (raw_text_element.cc)
    el.attrs.text = s
    host.elements.push(el)
    return el
  }
  g.__AppendElement = (parent: FakeEl, child: FakeEl) => {
    if (child.parent) {
      const oldIdx = child.parent.children.indexOf(child)
      if (oldIdx >= 0)
        child.parent.children.splice(oldIdx, 1)
    }
    parent.children.push(child)
    child.parent = parent
  }
  g.__InsertElementBefore = (
    parent: FakeEl,
    child: FakeEl,
    ref?: FakeEl,
  ) => {
    if (child.parent) {
      const oldIdx = child.parent.children.indexOf(child)
      if (oldIdx >= 0)
        child.parent.children.splice(oldIdx, 1)
    }
    child.parent = parent
    if (!ref) {
      parent.children.push(child)
      return
    }
    const idx = parent.children.indexOf(ref)
    if (idx < 0) {
      // Lenient by default (historical): append. Strict mode mirrors the
      // native engine, which rejects non-child anchors instead of guessing.
      // List parents are exempt: their items live in the datasource, so no
      // list anchor is ever found in children.
      if (host.strictAnchors && parent.type !== 'list') {
        throw new Error(
          '[fake-papi] __InsertElementBefore: anchor is not a child of parent',
        )
      }
      parent.children.push(child)
      return
    }
    parent.children.splice(idx, 0, child)
  }
  g.__RemoveElement = (parent: FakeEl, child: FakeEl) => {
    const idx = parent.children.indexOf(child)
    if (idx >= 0)
      parent.children.splice(idx, 1)
    child.parent = null
  }
  g.__SetAttribute = (el: FakeEl, key: string, value: unknown) => {
    el.attrs[key] = value
  }
  g.__InvokeUIMethod = (
    el: FakeEl,
    method: string,
    params: Record<string, unknown>,
    cb?: (res: { code: number, data: unknown }) => void,
  ) => {
    host.invokeCalls.push({ uid: el.uid, method, params })
    cb?.({ code: 0, data: null })
    return []
  }
  g.__SetInlineStyles = (el: FakeEl, style: unknown) => {
    if (typeof style === 'string') {
      el.attrs.style = style
      if (style === '') {
        // Full clear: keep keys as '' so `style.color === ''` holds (DOM reports '')
        for (const k in el.style) el.style[k] = ''
      }
      else {
        // Non-empty string replaces whole style — per-key dict cleared
        for (const k in el.style) delete el.style[k]
      }
      return
    }
    // Object form is now full replacement (SET_STYLE). Keys absent
    // from the new object are cleared to '' (DOM removal reports ''), then
    // new ones are set. Keys are stored kebab-cased to match
    // __AddInlineStyle's conversion.
    const raw = (style ?? {}) as Record<string, unknown>
    const normalized: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (v != null) {
        const cssKey = k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
        normalized[cssKey] = String(v)
      }
    }
    for (const k in el.style) {
      if (!(k in normalized))
        el.style[k] = ''
    }
    for (const [k, v] of Object.entries(normalized))
      el.style[k] = v
    el.attrs.style = { ...el.style }
  }
  g.__AddInlineStyle = (el: FakeEl, key: string, value: string) => {
    // Lynx engine: adding '' clears the declaration — the DOM reports
    // '' for a removed property, but our dict stores '' so tests can
    // assert `style.filter === ''` (see style-fragment.test). Keep ''.
    if (value === '')
      el.style[key] = ''
    else el.style[key] = value
    el.attrs.style = { ...el.style }
  }
  g.__SetClasses = (el: FakeEl, cls: string) => {
    el.attrs.class = cls
  }
  g.__SetID = (el: FakeEl, id: string | undefined) => {
    if (id)
      el.attrs.id = id
  }
  g.__SetCSSId = (_els: FakeEl[], _cssId: number) => {
    // recorded no-op
  }
  g.__AddEvent = (
    el: FakeEl,
    eventType: string,
    eventName: string,
    evt?: string,
  ) => {
    if (evt === undefined) {
      el.events = el.events.filter(
        e => e.eventType !== eventType || e.eventName !== eventName,
      )
      return
    }
    el.events.push({ eventType, eventName, sign: evt })
  }
  g.__GetElementUniqueID = (el: FakeEl) => el.uid
  g.__FlushElementTree = () => {
    host.flushCount++
  }

  return host
}

/** Text of every descendant, depth-first — handy for tree assertions. */
export function treeText(el: FakeEl): string[] {
  const out: string[] = []
  const visit = (n: FakeEl) => {
    if (n.type === 'text' || n.type === 'rawtext')
      out.push(String(n.attrs.text ?? ''))
    for (const c of n.children) visit(c)
  }
  visit(el)
  return out
}
