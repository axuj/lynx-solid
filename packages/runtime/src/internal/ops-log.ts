import type { OpCode } from './ops'
/**
 * Ops/event observation bridge for the compile-lab preview.
 *
 * Broadcasts human-readable communication lines (BG→MT ops frames, MT→BG
 * event round-trips) on a fixed BroadcastChannel; the preview host renders
 * them in its ops panel. Observing is pure side-channel output — it never
 * touches the protocol or the engine, so it is safe to ship in the real
 * bundles (the channel is simply silent when nobody listens).
 */
import { OP, OP_ARITY } from './ops'

const CHANNEL_NAME = 'lynx-solid-ops'

// Type follows whichever program we compile under: the app program resolves
// BroadcastChannel from env.d.ts, the Node-side program from @types/node.
type BroadcastChannelInstance = InstanceType<typeof BroadcastChannel>

let channel: BroadcastChannelInstance | null | undefined

function getChannel(): BroadcastChannelInstance | null {
  // Web-host diagnostic API — absent on device (the typeof guard no-ops).
  // Each tsconfig program resolves the bare name from its own environment:
  // app → env.d.ts, Node-side tests/tooling → @types/node.
  if (channel !== undefined)
    return channel
  try {
    channel = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(CHANNEL_NAME)
      : null
  }
  catch {
    channel = null
  }
  return channel
}

function stamp(): string {
  return `${new Date().toLocaleTimeString('en-GB', { hour12: false })
  }.${String(Date.now() % 1000).padStart(3, '0')}`
}

function short(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    return s === undefined ? String(v) : s
  }
  catch {
    return String(v)
  }
}

/** One BG→MT ops frame, rendered as text (MT side reads the raw stream). */
export function fmtFrame(code: number, args: unknown[]): string {
  switch (code) {
    case OP.CREATE_PAGE: return 'CREATE_PAGE (root id=1)'
    case OP.CREATE: return `CREATE id=${String(args[0])} type=${String(args[1])}`
    case OP.CREATE_TEXT: return `CREATE_TEXT id=${String(args[0])}`
    case OP.INSERT: return `INSERT parent=${String(args[0])} child=${String(args[1])} anchor=${String(args[2])}`
    case OP.REMOVE: return `REMOVE parent=${String(args[0])} child=${String(args[1])}`
    case OP.SET_PROP: return `SET_PROP id=${String(args[0])} ${String(args[1])}=${short(args[2]).slice(0, 40)}`
    case OP.SET_TEXT: return `SET_TEXT id=${String(args[0])} text=${short(String(args[1])).slice(0, 40)}`
    case OP.SET_EVENT: return `SET_EVENT id=${String(args[0])} ${String(args[2])}=${String(args[3])}`
    case OP.REMOVE_EVENT: return `REMOVE_EVENT id=${String(args[0])} ${String(args[2])}`
    case OP.SET_STYLE: return `SET_STYLE id=${String(args[0])}`
    case OP.SET_CLASS: return `SET_CLASS id=${String(args[0])} class=${short(args[1]).slice(0, 40)}`
    case OP.SET_ID: return `SET_ID id=${String(args[0])} id=${short(args[1])}`
    case OP.INSTANTIATE: return `INSTANTIATE templateId=${String(args[0])} firstId=${String(args[2])} diffs=[${short(args[1]).slice(1, 81)}`
    case OP.RELEASE: return `RELEASE ids=${String(args[0])}×${String(args[1])}`
    default: return `OP_${String(code)}`
  }
}

/** Frames above this many → one summary line instead of per-frame detail. */
const MAX_DETAILED_FRAMES = 512

/** MT side: broadcast one ops batch as a single message. */
export function logOps(ops: unknown[]): void {
  const ch = getChannel()
  if (!ch)
    return
  // One postMessage per batch (was: one per frame — the frame-rate flood made
  // structured-clone cost dominate even with zero listeners).
  const lines: string[] = []
  let frames = 0
  let overflow = false
  let lastLine = ''
  let i = 0
  while (i < ops.length) {
    const code = ops[i++] as number
    const arity = OP_ARITY[code as OpCode] ?? 0
    const line = `[${stamp()}] BG → MT  ${fmtFrame(code, ops.slice(i, i + arity))}`
    frames++
    if (!overflow) {
      lines.push(line)
      if (frames > MAX_DETAILED_FRAMES)
        overflow = true
    }
    lastLine = line
    i += arity
  }
  if (frames === 0)
    return
  if (overflow) {
    ch.postMessage({
      kind: 'ops',
      text: `[${stamp()}] BG → MT  batch ×${frames} frames (detail suppressed over ${MAX_DETAILED_FRAMES}); head: ${lines[0]} … tail: ${lastLine}`,
    })
    return
  }
  ch.postMessage({ kind: 'ops', text: lines.join('\n') })
}

/** BG side: broadcast an event round-trip (engine → publishEvent). */
export function logEvent(sign: string, data: unknown, hit?: boolean): void {
  const ch = getChannel()
  if (!ch)
    return
  ch.postMessage({
    kind: 'event',
    text: `[${stamp()}] MT → BG  publishEvent(${sign})${
      hit === undefined ? '' : hit ? ' HIT' : ' MISS'
    } data=${short(data).slice(0, 60)}`,
  })
}
