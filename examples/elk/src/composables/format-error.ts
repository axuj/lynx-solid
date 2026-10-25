/**
 * Unified error formatting: any unknown becomes a readable string.
 * - Error: name + message + stack (no source maps in device BG, but stack still gives line numbers)
 * - undefined/null: labeled explicitly, so the console never shows a bare unlocatable undefined
 * - Other objects: JSON serialization (tolerates circular refs)
 */
export function formatError(e: unknown): string {
  if (e === undefined)
    return '(undefined — promise rejected without reason, or error slot never set)'
  if (e === null)
    return '(null)'
  if (e instanceof Error) {
    const stack = e.stack ? `\n${e.stack}` : ''
    return `${e.name}: ${e.message}${stack}`
  }
  if (typeof e === 'string')
    return e
  try {
    const seen = new WeakSet()
    const json = JSON.stringify(e, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v))
          return '[Circular]'
        seen.add(v)
      }
      if (typeof v === 'bigint')
        return String(v)
      if (typeof v === 'function')
        return '[fn]'
      return v
    }, 2)
    return json ?? String(e)
  }
  catch {
    return String(e)
  }
}

/** One-line summary, for UI text (newline-stripped to protect layout) */
export function formatErrorOneLine(e: unknown, max = 160): string {
  const s = formatError(e).replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}
