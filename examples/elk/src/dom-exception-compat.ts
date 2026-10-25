/**
 * What `installDOMException` writes: the one host global this module needs to
 * probe and replace. `unknown` on purpose — the implementation is a subset of
 * the DOM class, so the slot cannot be typed as the DOM type.
 */
interface DOMExceptionTarget {
  DOMException?: unknown
}

export function installDOMException(target: DOMExceptionTarget): void {
  if (typeof target.DOMException === 'function')
    return

  class CompatibleDOMException extends Error {
    constructor(message = '', name = 'Error') {
      super(message)
      this.name = name
    }
  }

  target.DOMException = CompatibleDOMException
}
