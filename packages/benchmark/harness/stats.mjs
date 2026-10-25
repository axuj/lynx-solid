/**
 * Statistics helpers — ported verbatim from the cross-framework harness of
 * vue-lynx-vapor (the vapor branch of https://github.com/Huxpro/vue-lynx,
 * Apache-2.0) so the report conventions match: median ± CI95, per-op
 * aggregation, DNF bookkeeping, within-load drift.
 */

export function stats(values) {
  const clean = values.filter(v => typeof v === 'number' && !Number.isNaN(v))
  if (clean.length === 0)
    return null
  const sorted = [...clean].sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((a, b) => a + b, 0) / n
  const median = n % 2
    ? sorted[(n - 1) / 2]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
  const std = Math.sqrt(
    sorted.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / n,
  )
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median,
    std,
    ci95: 1.96 * (std / Math.sqrt(n)),
  }
}

export function aggregate(loads) {
  const byOp = {}
  const dnfByOp = {}
  for (const load of loads) {
    for (const s of load.samples) {
      if (s.dnf)
        dnfByOp[s.op] = (dnfByOp[s.op] ?? 0) + 1
      else
        (byOp[s.op] ??= []).push(s.ms)
    }
  }
  const out = Object.fromEntries(
    Object.entries(byOp).map(([op, arr]) => [op, stats(arr)]),
  )
  for (const [op, n] of Object.entries(dnfByOp))
    out[op] = { ...(out[op] ?? {}), dnf: n }
  return out
}

/**
 * Within-load drift: median(last 3 samples) / median(first 3 samples),
 * averaged across loads. ~1.0 = stable per-op cost over the scenario;
 * >1 = the framework slows down as operations accumulate.
 */
export function drift(loads, op) {
  const ratios = []
  for (const load of loads) {
    const arr = load.samples.filter(s => s.op === op).map(s => s.ms)
    if (arr.length < 6)
      continue
    const first = stats(arr.slice(0, 3)).median
    const last = stats(arr.slice(-3)).median
    if (first > 0)
      ratios.push(last / first)
  }
  return ratios.length ? stats(ratios).mean : null
}

export const fmt = (x, digits = 1) => (x == null ? 'n/a' : x.toFixed(digits))
