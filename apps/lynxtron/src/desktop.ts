/**
 * The two surfaces this demo uses to talk to the main process.
 *
 * `NativeModules.bridge` and `lynx.getJSModule` are injected by the host, so
 * they are ambient globals, not imports. `@lynx-js/types` already declares
 * both (`bridge` has `call`/`on`, `getJSModule` overloads `GlobalEventEmitter`)
 * — this file only narrows the payloads and hides the callback plumbing.
 */

export interface AppGlobalProps {
  window?: string
  launchedAt?: string
}

/** Props the main process passed to `loadFile`/`loadURL`. */
export function readGlobalProps(): AppGlobalProps {
  return (lynx.__globalProps ?? {}) as AppGlobalProps
}

/** UI → main. 0.0.31 has `call`/`on` only; the `send` in newer docs is absent. */
export function callMain(method: string, params: Record<string, unknown> = {}) {
  NativeModules.bridge.call(method, params, () => {})
}

/** main → UI, via `win.sendGlobalEvent(...)`. Returns the unsubscribe function. */
export function onMainEvent<T>(event: string, listener: (payload: T) => void) {
  const emitter = lynx.getJSModule('GlobalEventEmitter')
  const handler = (...args: unknown[]) => listener(args[0] as T)
  emitter.addListener(event, handler)
  return () => emitter.removeListener(event, handler)
}
