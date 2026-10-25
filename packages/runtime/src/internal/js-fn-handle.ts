/**
 * Shared `JsFnHandle` wire shape — lives in `internal/` so both the BG
 * entry (dist/index.js) and the MT entry (dist/main-thread/index.js) of the
 * single-tree build can import it without cross-boundary contamination.
 *
 * **Do not import runtime-only values from background/ or main-thread/**
 * in this file — it is the sole shared type module.
 */
export interface JsFnHandle {
  _jsFnId?: number
  _execId?: number
  _isFirstScreen?: boolean
  _error?: string
}
