/**
 * Router search-param codec that does not need `URLSearchParams`.
 *
 * TanStack Router's default codec (`router-core`'s `qss`) builds a
 * `URLSearchParams`. The Lynx main thread has no such class, and the router is
 * created at module scope — so on the IFR main thread the app died with
 * "ReferenceError: URLSearchParams is not defined" before the first frame, and
 * the app-level polyfill could not help (it is evaluated too late).
 *
 * `parseSearch` / `stringifySearch` are the router's documented seam, so
 * overriding them removes the dependency instead of faking a global.
 *
 * Semantics mirror `parseSearchWith(JSON.parse)` /
 * `stringifySearchWith(JSON.stringify, JSON.parse)`: values that look like JSON
 * are JSON-parsed, everything else stays a string.
 */

// JSON can start with whitespace, ", [, {, -, a digit, or one of the words
// false/null/true — the same fast path router-core uses (it only avoids
// throwing on values that clearly cannot be JSON).
const jsonStart = /^(?:[\s"[{\d\-]|[fnt][aur])/

function decodeComponent(value: string): string {
  try {
    // `+` means space in the urlencoded form.
    return decodeURIComponent(value.replace(/\+/g, ' '))
  }
  catch {
    return value
  }
}

/**
 * The urlencoded serializer (what `URLSearchParams.toString()` produces):
 * everything but the unreserved set is percent-encoded, and a space is `+`.
 * `encodeURIComponent` leaves `!'()~` alone, so they are escaped here — the
 * main thread and the background thread must produce byte-identical query
 * strings, or the two trees drift.
 */
function encodeComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+')
}

export function parseSearch(searchStr: string): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  const raw = searchStr.startsWith('?') ? searchStr.slice(1) : searchStr
  if (!raw)
    return query
  for (const part of raw.split('&')) {
    if (!part)
      continue
    const eq = part.indexOf('=')
    const key = decodeComponent(eq < 0 ? part : part.slice(0, eq))
    const value = eq < 0 ? '' : decodeComponent(part.slice(eq + 1))
    // Duplicate keys: the last one wins (URLSearchParams semantics).
    query[key] = value
  }
  for (const key in query) {
    const value = query[key]
    if (typeof value !== 'string' || !jsonStart.test(value))
      continue
    try {
      query[key] = JSON.parse(value)
    }
    catch {
      // Not JSON after all — keep the string.
    }
  }
  return query
}

export function stringifySearch(search: Record<string, unknown>): string {
  const parts: string[] = []
  for (const key in search) {
    const value = search[key]
    if (value === undefined)
      continue
    let text: string
    if (value !== null && typeof value === 'object') {
      try {
        text = JSON.stringify(value)
      }
      catch {
        text = String(value)
      }
    }
    else if (typeof value === 'string' && jsonStart.test(value)) {
      try {
        // Re-serialize parseable strings, like router-core does.
        JSON.parse(value)
        text = JSON.stringify(value)
      }
      catch {
        text = value
      }
    }
    else {
      text = String(value)
    }
    parts.push(`${encodeComponent(key)}=${encodeComponent(text)}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}
