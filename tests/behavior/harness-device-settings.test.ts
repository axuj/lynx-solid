/**
 * Harness guard: a driver may only change a device setting through
 * `harness/keep-awake.mjs`.
 *
 * Why this exists: the same "raise the screen timeout for a run" logic was
 * hand-written three times and was wrong three different ways — `svc power
 * stayon usb` never restored, `2147483647` never restored, and a "restore" that
 * wrote `2` instead of the original value. Each copy looked reasonable on its
 * own; only the pattern across files shows the defect. `screen_off_timeout` and
 * `stay_on_while_plugged_in` are persistent (they survive reboots and apply to
 * the whole phone), so a wrong copy leaves the owner's phone awake.
 *
 * The module is the fix; this test keeps the next copy from being written.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const HARNESS = path.join(ROOT, 'packages/benchmark/harness')
const MODULE = 'keep-awake.mjs'

/** Harness sources, minus the module that is allowed to own the behaviour. */
function harnessSources(): Array<{ file: string, src: string }> {
  return readdirSync(HARNESS)
    .filter(f => f.endsWith('.mjs') && f !== MODULE)
    .map(file => ({ file, src: readFileSync(path.join(HARNESS, file), 'utf8') }))
}

/** Strip comments so explanatory text (which mentions the old mistakes) passes. */
function code(src: string): string {
  return src
    .split('\n')
    .filter(line => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

describe('harness device-settings guard', () => {
  it('no driver turns on stay-on-while-plugged-in', () => {
    // It has no expiry: a forgotten restore leaves the phone awake indefinitely,
    // and a bounded `screen_off_timeout` already covers a run.
    const offenders = harnessSources()
      .filter(({ src }) => /svc['"\s,\]]+power['"\s,\]]+stayon|stay_on_while_plugged_in['"\s,\]]*,\s*['"]?\d/.test(code(src)))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('no driver writes the timeout outside the shared module', () => {
    const offenders = harnessSources()
      .filter(({ src }) => /settings['"\s,\]]+put['"\s,\]]+system['"\s,\]]+screen_off_timeout/.test(code(src)))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('no driver re-implements the restore, and no driver writes an unbounded value', () => {
    for (const { file, src } of harnessSources()) {
      // A local copy is how the three divergent versions appeared.
      expect(code(src), `${file} re-implements restoreOnExit`).not.toMatch(/function\s+restoreOnExit/)
      // 2147483647 ms = "never"; a SIGKILL would then pin the phone awake.
      expect(code(src), `${file} writes an unbounded timeout`).not.toContain('2147483647')
    }
  })

  it('every driver that keeps the screen awake imports the shared module', () => {
    const users = harnessSources()
      .filter(({ src }) => code(src).includes('withScreenAwake('))
      .map(({ file }) => file)
    expect(users.length).toBeGreaterThan(0)
    for (const { file, src } of harnessSources()) {
      if (!code(src).includes('withScreenAwake('))
        continue
      expect(src, `${file} calls withScreenAwake without importing it`)
        .toMatch(new RegExp(`from '\\./${MODULE.replace('.', '\\.')}'`))
    }
  })
})
