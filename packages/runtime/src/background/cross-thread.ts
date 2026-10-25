/**
 * BG → MT cross-thread call bridge.
 *
 * The only native transport: lynx.getNativeApp().callLepusMethod(method,
 * params). Used for the ops batch (lynxSolidApplyOps) and for forwarding
 * main-thread events to the MT (lynxSolidMtDispatch). Standalone module so
 * entry.ts (ops transport) and event-registry.ts (event forwarding) share it
 * without a circular import.
 */

// `lynx` is injected by the runtime wrapper as a function parameter of the
// tt.define callback — a bare identifier inside every module in the bundle.
declare let lynx: {
  getNativeApp: () => {
    callLepusMethod: (
      method: string,
      params: unknown,
      callback: () => void,
    ) => void
  }
}

export function callLepusMethod(method: string, params: unknown): void {
  lynx.getNativeApp().callLepusMethod(method, params, () => {})
}
