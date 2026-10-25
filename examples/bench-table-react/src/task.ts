// Per-tick task scheduler for the storm workloads — one state→render cycle
// per macrotask, never batched. MessageChannel when available (no setTimeout
// nesting clamp), bare setTimeout fallback (Lynx native BG timers live as
// bare identifiers, not on globalThis).
type Task = () => void

const channel: MessageChannel | null
  = typeof MessageChannel === 'function' ? new MessageChannel() : null
let pendingTask: Task | null = null

if (channel) {
  channel.port1.onmessage = () => {
    const task = pendingTask
    pendingTask = null
    if (task)
      task()
  }
}

export function nextTask(task: Task): void {
  if (!channel) {
    setTimeout(task, 0)
    return
  }
  pendingTask = task
  channel.port2.postMessage(0)
}

/** Run fn(tick) for tick = 1..ticks inclusive, each in its own task. */
export function runTicks(ticks: number, fn: (tick: number) => void): void {
  let t = 0
  const tick = () => {
    t += 1
    fn(t)
    if (t < ticks)
      nextTask(tick)
  }
  nextTask(tick)
}
