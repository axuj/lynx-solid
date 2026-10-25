/**
 * Error coercion helpers.
 *
 * In modern TS (useUnknownInCatchVariables) a `catch` clause binds the error as
 * `unknown`, so any attribute access needs narrowing before it can be read.
 * These two helpers centralize that single `instanceof Error` check — call
 * them instead of repeating the narrow inlining at every catch site.
 */

/** Coerce an unknown caught value to a readable message. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * First stack frames of an unknown caught value, or '' when it has no usable
 * stack. The leading frame (the throw site) is skipped, matching the
 * insert-failure snippet we log.
 */
export function errorStack(e: unknown): string {
  return e instanceof Error ? e.stack?.split('\n').slice(1, 5).join('\n') ?? '' : ''
}
