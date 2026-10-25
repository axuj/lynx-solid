/**
 * jsdom-backed Lynx PAPI environment: same engine globals as fake-papi, but
 * the operations land on real DOM nodes (jsdom), so ported solid-web tests
 * can assert with DOM semantics (innerHTML / className / textContent).
 *
 * The page root is the mount container: the component tree is appended
 * directly onto it, matching `render(comp, container)` in the official tests.
 */

declare global {
  interface Element {
    __lynxUid?: number
    __lynxEvents?: { eventType: string, eventName: string, sign?: string }[]
  }
}

export interface JsdomPapiHost {
  root: HTMLElement
  flushCount: number
}

export function mountJsdomPapi(container: HTMLElement): JsdomPapiHost {
  const host: JsdomPapiHost = { root: container, flushCount: 0 }

  // Engine mock — deliberately loose: fakes do not satisfy the strict
  // LynxElement surface; this file IS the stand-in for the engine.
  const g = globalThis as Record<string, unknown>
  const uidCounter = { next: 2 }

  g.__CreatePage = () => {
    container.__lynxUid = 1
    return container
  }
  g.__CreateElement = (tag: string) => {
    const el = document.createElement(tag)
    el.__lynxUid = uidCounter.next++
    return el
  }
  g.__CreateText = () => {
    const el = document.createElement('text')
    el.__lynxUid = uidCounter.next++
    return el
  }
  g.__CreateRawText = (s: string) => document.createTextNode(s)
  g.__AppendElement = (parent: HTMLElement, child: HTMLElement) => {
    parent.appendChild(child)
  }
  g.__InsertElementBefore = (parent: HTMLElement, child: HTMLElement, ref?: HTMLElement) => {
    if (ref && ref.parentNode === parent)
      parent.insertBefore(child, ref)
    else
      parent.appendChild(child)
  }
  g.__RemoveElement = (_parent: HTMLElement, child: HTMLElement) => {
    child.remove()
  }
  g.__SetAttribute = (el: HTMLElement, key: string, value: unknown) => {
    if (key === 'text')
      el.textContent = value == null ? '' : String(value)
    else if (value == null)
      el.removeAttribute(key)
    else
      el.setAttribute(key, String(value))
  }
  g.__SetInlineStyles = (el: HTMLElement, style: unknown) => {
    if (style == null) {
      el.removeAttribute('style')
      return
    }
    if (typeof style === 'string') {
      el.setAttribute('style', style)
      return
    }
    for (const [k, v] of Object.entries(style as Record<string, unknown>))
      el.style.setProperty(k, v == null ? '' : String(v))
  }
  g.__AddInlineStyle = (el: HTMLElement, key: string, value: string) => {
    el.style.setProperty(key, value)
  }
  g.__SetClasses = (el: HTMLElement, cls: string) => {
    el.setAttribute('class', cls)
  }
  g.__SetID = (el: HTMLElement, id: string | undefined) => {
    if (id)
      el.setAttribute('id', id)
  }
  g.__SetCSSId = () => {
    // recorded no-op
  }
  g.__AddEvent = (
    el: HTMLElement,
    eventType: string,
    eventName: string,
    sign?: string,
  ) => {
    const events = el.__lynxEvents ?? (el.__lynxEvents = [])
    if (sign === undefined) {
      const idx = events.findIndex(e => e.eventType === eventType && e.eventName === eventName)
      if (idx >= 0)
        events.splice(idx, 1)
      return
    }
    const idx = events.findIndex(e => e.eventType === eventType && e.eventName === eventName)
    if (idx >= 0)
      events[idx] = { eventType, eventName, sign }
    else
      events.push({ eventType, eventName, sign })
  }
  g.__GetElementUniqueID = (el: HTMLElement) => el.__lynxUid
  g.__FlushElementTree = () => {
    host.flushCount++
  }

  return host
}
