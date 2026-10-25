// Measurement hook for the ReactLynx arm of the benchmark — emits the engine's
// own first-frame decomposition as one `[lynx-solid BG] perf {…}` line, the
// format the device runs are read by hand (the Solid arm has no runtime probe;
// it is benchmark-local code on both sides).
//
// The engine only collects pipeline timestamps for a pipeline whose element
// tree carried a non-empty `__lynx_timing_flag` (`ElementManager::
// BindTimingFlagToPipelineOptions`), which is why `App.tsx` marks the root.
// Entries then arrive on the background thread, where `console.alog`
// (LOG_SOURCE_JS_EXT) survives a release build's logcat.
//
// Installed at module scope, before `root.render`, so the first-screen entry is
// not missed. Benchmark-only code: not part of either framework.

export function installPerfProbe(): void {
  try {
    const observer = lynx.performance.createObserver((entry) => {
      // as: engine-published, versioned entry; only the generic numeric
      // <mark>Start/<mark>End pairs are needed, never a fixed declared shape.
      const raw = entry as unknown as Record<string, unknown>
      const base = typeof raw.loadBundleStart === 'number'
        ? raw.loadBundleStart
        : raw.pipelineStart
      const marks: Record<string, number> = {}
      if (typeof base === 'number') {
        for (const key of Object.keys(raw)) {
          const value = raw[key]
          if (typeof value !== 'number')
            continue
          if (!key.endsWith('Start') && !key.endsWith('End'))
            continue
          marks[key] = Math.round((value - base) * 100) / 100
        }
      }
      const data: Record<string, unknown> = {
        entry: `${String(raw.entryType)}/${String(raw.name)}`,
        marks,
      }
      if (typeof raw.identifier === 'string' && raw.identifier.length > 0)
        data.id = raw.identifier
      const host = raw.hostPlatformTiming
      if (host && typeof host === 'object')
        data.host = host
      for (const metric of ['fcp', 'lynxFcp', 'totalFcp', 'actualFmp']) {
        const value = raw[metric]
        if (value && typeof value === 'object' && 'duration' in value)
          data[metric] = Math.round((value as { duration: number }).duration)
      }
      const line = `[lynx-solid BG] perf ${JSON.stringify(data)}`
      console.log(line)
      // as: `alog` is the engine's release-visible channel and is absent from
      // the web host / test doubles, so it is looked up defensively.
      const alog = (console as unknown as { alog?: (s: string) => void }).alog
      if (typeof alog === 'function')
        alog(line)
    })
    observer.observe(['init', 'pipeline', 'metric', 'resource'])
  }
  catch {
    // Host without the Performance API: the arms still compare by wall clock.
  }
}
