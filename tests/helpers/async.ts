/** Flush the microtask queue (drives queueMicrotask-scheduled flushes). */
export async function flushPromises(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}
