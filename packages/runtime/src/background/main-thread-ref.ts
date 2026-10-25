/**
 * MainThreadRef — a cross-thread element/value binding for Main Thread
 * Scripts, mirroring the official `useMainThreadRef` model.
 *
 * On the Background Thread `.current` is a read-only placeholder (the initial
 * value). The ref gets a worklet value id (`_wvid`) that is shipped to the
 * Main Thread via INIT_MT_REF; binding a native element (`main-thread:ref`)
 * sends SET_MT_REF, after which the MT resolves `_wvid` → element and the
 * serialized handler's free-variable capture (the ref's name in source) is
 * resolved to the live element on the Main Thread.
 */

import { sink } from './ops-sink'

let nextWvid = 1

export class MainThreadRef<T = unknown> {
  /** Worklet value id — the MT ref map key. */
  readonly _wvid: number

  /** BG-side placeholder; the MT owns the real value. */
  current: T

  constructor(initValue: T) {
    this._wvid = nextWvid++
    this.current = initValue
    sink.initMtRef(this._wvid, initValue)
  }

  /** Serialize for cross-thread transfer (ops buffer JSON). */
  toJSON(): { _wvid: number } {
    return { _wvid: this._wvid }
  }
}

export function useMainThreadRef<T>(initValue: T): MainThreadRef<T> {
  return new MainThreadRef<T>(initValue)
}

/** Reset module state — for testing only. */
export function resetMainThreadRefState(): void {
  nextWvid = 1
}
