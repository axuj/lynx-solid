/**
 * JSX typing for lynx-solid on solid-js 2.
 *
 * solid-js 2 dropped the module-scoped `JSX` namespace from the main package
 * and TS 5.9 resolves JSX types for `jsx: preserve` from the *global* `JSX`
 * namespace. `@lynx-js/types` already opens a global `JSX` merge point
 * (IntrinsicAttributes), so we extend the same namespace with the lynx
 * intrinsic elements instead of augmenting a package module.
 *
 * Element props come straight from the official `IntrinsicElements`; Solid's
 * `children`/`ref` are added once on `StandardProps`, the same seam ReactLynx
 * augments, and `ElementChildrenAttribute` (`children: {}`) keeps children
 * untyped, mirroring Solid's own.
 */

import type {
  BaseEvent,
  ContentSizeChangedEvent,
  InputInputEvent,
  IntrinsicElements as LynxIntrinsicElements,
  ScrollEndEvent,
  ScrollEvent,
  ScrollToLowerEvent,
  ScrollToUpperEvent,
} from '@lynx-js/types'
import type {
  LayoutChangeEvent as MainThreadLayoutChangeEvent,
} from '@lynx-js/types/main-thread'
import type { MainThreadRef } from './background/main-thread-ref'
import type { MainThreadScrollEvent } from './internal/main-thread-events'

// `main-thread:ref` lives on every Lynx element; the official types package
// does not declare it (react-lynx adds it via its own augmentation:
// packages/react/types/react.d.ts `'main-thread:ref'?: Ref<MainThread.Element>`).
// We augment the same seam with our MainThreadRef value type.
//
// The official worklet-event mapping (types/main-thread/events.d.ts) derives
// `main-thread:bind*` keys from LynxEventPropsBase, so touch handlers already
// arrive typed. It omits the scroll family — `main-thread:bindscroll` & co.
// are missing — so those are declared below. Their payloads come from the
// background ScrollEvent family, whose `target` is the background `Target`;
// `MainThreadScrollEvent` (exported from the runtime) re-types just
// target/currentTarget to the live MT element.
//
// layoutchange is the one payload re-declared below: its `params` is
// Android-only and deprecated while `detail` is available everywhere, so the
// official "both required" shape over-claims `params` on iOS/Harmony/PC. See
// examples/elk Sheet, which reads `detail?.height ?? params?.height`.
//
// Events use the Lynx bind* names exclusively: a lynx event is not a DOM
// event (different propagation and event object), so DOM-style `on*` aliases
// are intentionally not declared (and not translated at runtime either).
interface WorkletScrollEvents {
  'main-thread:bindscroll'?: (event: MainThreadScrollEvent<ScrollEvent>) => void
  'main-thread:bindscrollend'?: (event: MainThreadScrollEvent<ScrollEndEvent>) => void
  'main-thread:bindscrolltoupper'?: (event: MainThreadScrollEvent<ScrollToUpperEvent>) => void
  'main-thread:bindscrolltolower'?: (event: MainThreadScrollEvent<ScrollToLowerEvent>) => void
  'main-thread:bindcontentsizechanged'?: (event: MainThreadScrollEvent<ContentSizeChangedEvent>) => void
}

/**
 * `params` is Android-only and deprecated; every other platform sends only
 * `detail`, so that is the single member the official type over-claims.
 */
type MtLayoutChangeEvent = Omit<MainThreadLayoutChangeEvent, 'params'> & {
  params?: MainThreadLayoutChangeEvent['params']
}

declare module '@lynx-js/types' {
  interface StandardProps {
    // Solid's JSX needs both on the element props. ReactLynx adds the same
    // pair (children / ref) to StandardProps in its own augmentation; the
    // official Lynx types alone only describe the engine attributes.
    'children'?: unknown
    'ref'?: (el: unknown) => void
    'main-thread:ref'?: MainThreadRef<unknown>
    'main-thread:bindlayoutchange'?: (event: MtLayoutChangeEvent) => void
  }
  interface ScrollViewProps extends WorkletScrollEvents {}

  // The native runtime treats `value` on <input>/<textarea> as the initial
  // content (post-mount updates go through the setValue UI method); the
  // official types package only declares 'default-value'. Declare the value
  // prop so v-model-style bindings type-check.
  interface InputProps {
    value?: string
  }
  interface TextAreaProps {
    value?: string
  }

  // Input event object shared by <input>/<textarea> bindinput handlers;
  // the official types package does not export a named alias for it.
  export interface InputEvent extends BaseEvent<'bindinput', InputInputEvent> {}
}

/* eslint-disable ts/no-namespace, ts/no-empty-object-type */
declare global {
  namespace JSX {
    type Element = import('solid-js').Element

    // The official list is complete and exported; extending it keeps every
    // element (and every future one) typed without a hand-copied subset.
    interface IntrinsicElements extends LynxIntrinsicElements {}

    interface ElementChildrenAttribute {
      children: {}
    }
  }
}
/* eslint-enable ts/no-namespace, ts/no-empty-object-type */

export {}
