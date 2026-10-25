/**
 * Shared first-screen mark tracker + completion rule.
 *
 * Both harnesses used to carry their own copy of the completion heuristic, and
 * they drifted: one had a `settleFloor` derived from the row count, the other
 * did not. This is the single implementation.
 *
 * ## Why the rule looks like this
 *
 * The engine's `layout finish` log fires for the *empty page* too — in the
 * non-IFR path it comes within a millisecond of `LoadTemplate`, long before the
 * background thread has produced any content, and then there is a gap until the
 * content layout that measured 1079 ms in one session and 1867 ms in another.
 * A bare "no new layout for N ms" rule therefore expires inside that gap and
 * reports the empty page (152 ms for a ~2 s first screen).
 *
 * `WithPatch!` cannot help: it only means "this flush scheduled a layout", and
 * the empty page's first patch is also a `WithPatch!` (element_manager.cc:1841).
 *
 * One signal discriminates, and it is measured rather than structural:
 * `layout finish ... Time taken: N ns` — the empty page lays out in 0.03-1.00 ms
 * across both devices we measure, real content in 2.2-223 ms
 * (layout_context.cc:894). The content frame is therefore the first
 * `layout finish` whose `Time taken` clears 1.5 ms; `lynx runtime ready` is
 * recorded for the timeline but is NOT used as a door — see
 * CONTENT_MIN_LAYOUT_MS for the two devices that door mis-scored.
 * Reported timestamps are DEVICE epoch values, so a slow poll never biases the
 * measurement; only the wall-clock stop decision uses host time.
 *
 * There is deliberately NO time-based fallback. One was tried (`FALLBACK_MS`)
 * and is wrong: the empty-page → content gap is not bounded, so any fixed floor
 * either fires early (reporting the empty page) or wastes the phone. Waiting
 * for a gated frame has no such failure mode on the paths we measure, because
 * both of them produce one. `capExpired` is the single fallback path, and the
 * caller flags those reps so they can be discarded instead of averaged in.
 */

/**
 * Below this a layout is the empty page's no-op pass, not content.
 *
 * Why 1.5 ms, and why `lynx runtime ready` is NOT part of the rule: the engine
 * logs a `layout finish` for the empty page too, and two bands separate it from
 * real content across both devices we measure:
 *
 *              empty page      content
 *   BKL-AL20   0.88 - 1.00     4.70 - 12.3   (0-50 rows)
 *   K80        0.03 - 0.44     2.18 - 2.84   (0 rows, both MT paths)
 *
 * 1.5 ms sits inside both gaps (1.5x / 3.1x on the old phone, 3.4x / 1.45x on
 * the flagship). Earlier values were wrong in both directions, and each failure
 * was found on a device: at 1 ms the empty page (measured at exactly 1.00 ms)
 * was scored as content and a 1000-row default rep came out ~2 s fast; at 3 ms
 * the flagship rejected a genuine content frame (2.334 ms) and reported a whole
 * arm as `cap-exceeded`.
 *
 * `ready` stays OUT of the condition. It used to be a door ("content must be at
 * or after ready"), with a pre-ready escape hatch; that made the verdict depend
 * on when the log happened to be read: the same arm in the same window scored
 * 150 ms when the read happened before `ready` appeared in the buffer and 190 ms
 * after, because a re-layout then won the gated search. With the duration floor
 * calibrated on both devices, the floor alone is the discriminator and the
 * answer is the FIRST content-quality layout whether the runtime was ready yet
 * or not — which is also the quantity the IFR arm is supposed to win on.
 */
export const CONTENT_MIN_LAYOUT_MS = 1.5

export function createTracker() {
  const s = {
    proc: undefined,
    shell: undefined,
    load: undefined,
    ready: undefined,
    layouts: [],
    /** The first `am_kill` for the package after our process start, if any. */
    kill: undefined,
    /** Wall clock when the newest layout timestamp first appeared. */
    lastNewWall: 0,
  }

  return {
    state: s,

    /** Feed one logcat line (idempotent — safe to re-read a whole buffer). */
    ingest(line) {
      if (/am_proc_start/.test(line) && /com\.lynx\.explorer/.test(line)) {
        const m = /^(\d{10,13}(?:\.\d{1,9})?)/.exec(line.trim())
        if (m && s.proc === undefined)
          s.proc = Number(m[1])
        return
      }
      const m = /^\s*(\d{10,13}(?:\.\d{1,9})?)\s/.exec(line)
      if (!m)
        return
      const t = Number(m[1])

      if (/LynxShell create/.test(line)) {
        if (s.shell === undefined)
          s.shell = t
      }
      else if (/start TemplateAssembler::LoadTemplate/.test(line)) {
        if (s.load === undefined)
          s.load = t
      }
      else if (/lynx runtime ready/.test(line)) {
        if (s.ready === undefined)
          s.ready = t
      }
      else if (/layout finish with result size/.test(line)) {
        const d = /Time taken:\s*(\d+)\s*ns/.exec(line)
        const durMs = d ? Number(d[1]) / 1e6 : Number.POSITIVE_INFINITY
        const prev = s.layouts[s.layouts.length - 1]
        if (!prev || prev.t !== t) {
          s.layouts.push({ t, durMs })
          s.lastNewWall = Date.now()
        }
      }
      else if (s.proc !== undefined && s.kill === undefined
        && /am_kill/.test(line) && /com\.lynx\.explorer/.test(line)) {
        // Who killed a process of ours, and why. This is the ONLY trace of the
        // case that used to be invisible: on EMUI/iAware the freshly forked
        // process is killed 3 ms after `am_proc_start`, so the app never writes a
        // line, `pidof` is empty by the time the rig looks, and `am start -W`
        // waits forever for an activity that was already destroyed. `classify`
        // names the killer from this line.
        s.kill = line.trim()
      }
    },

    /**
     * `_nowWall` is host time. Returns null while no frame has been recognised
     * yet, otherwise the resolution — and it resolves the INSTANT a frame is
     * recognised, with no settle/quiet window.
     *
     * The settle window was wrong twice over: it made every rep wait an extra
     * ~0.7-1.2 s (poll granularity plus the window itself), and taking the
     * "last" frame pulled ReactLynx's post-hydration re-layout into its number.
     * The quantity being measured is when content FIRST appears, so the first
     * recognised frame is the answer; anything later is a different event.
     */
    decide(_nowWall) {
      // No anchor, no verdict. A frame is only a measurement *relative to a
      // process start*, so until this rep's own `am_proc_start` has been seen there
      // is nothing to measure against — and any layout already in hand belongs to
      // an earlier launch. Resolving without it is how a stream-fed window scored
      // a late line from the PREVIOUS rep, ended the rep ~900 ms in, and reported a
      // launch that had in fact painted as `missing: am_proc_start`.
      if (s.proc === undefined || s.layouts.length === 0)
        return null

      // Only layouts at or after THIS process start count. In the pull transport
      // `logcat -b events,main` prints the buffers as two grouped sections, not one
      // merged stream, so the window after the anchor contains the whole `main`
      // section — including frames from earlier launches that are newer in file
      // order and older in time. Over a stream the same filter covers a line that
      // arrives late. Without it those would win and then be rejected as
      // `stale-buffer`, i.e. a real rep lost to a logging layout accident.
      const mine = s.layouts.filter(l => l.t >= s.proc)

      // Content = the first layout that took long enough to be content. The
      // `ready` door is deliberately absent (see CONTENT_MIN_LAYOUT_MS): gating
      // on it made the same arm/window answer 150 ms or 190 ms depending on when
      // the log was read. A missing `Time taken` is the one case the floor cannot
      // judge, so it is only accepted once the runtime is up (tier 2) — an
      // unlabelled empty-page layout must not win.
      const timed = mine.find(l => l.durMs !== Number.POSITIVE_INFINITY
        && l.durMs >= CONTENT_MIN_LAYOUT_MS)
      const untimed = s.ready === undefined
        ? undefined
        : mine.find(l => l.durMs === Number.POSITIVE_INFINITY && l.t >= s.ready)
      const content = timed ?? untimed
      if (!content)
        return null

      return {
        contentT: content.t,
        tier: timed ? 1 : 2,
        layoutCount: s.layouts.length,
      }
    },
  }
}
