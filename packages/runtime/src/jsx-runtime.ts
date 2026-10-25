/**
 * JSX typing for lynx-solid on solid-js 2.
 *
 * solid-js 2 dropped the module-scoped `JSX` namespace from the main package
 * and TS 5.9 resolves JSX types for `jsx: preserve` from the *global* `JSX`
 * namespace. `@lynx-js/types` already opens a global `JSX` merge point
 * (IntrinsicAttributes), so we extend the same namespace with the lynx
 * intrinsic elements instead of augmenting a package module.
 *
 * Element props come straight from @lynx-js/types; `ElementChildrenAttribute`
 * (`children: {}`) keeps the children prop untyped, mirroring Solid's own.
 */

import type {
  BaseEvent,
  ComponentProps,
  ImageProps,
  InputInputEvent,
  InputProps,
  ListItemProps,
  ListProps,
  NoProps,
  PageProps,
  ScrollViewProps,
  StandardProps,
  TextAreaProps,
  TextProps,
  ViewProps,
} from '@lynx-js/types'
import type { MainThreadRef } from './background/main-thread-ref'

// `main-thread:ref` lives on every Lynx element; the official types package
// does not declare it (react-lynx adds it via its own augmentation:
// packages/react/types/react.d.ts `'main-thread:ref'?: Ref<MainThread.Element>`).
// We augment the same seam with our MainThreadRef value type.
//
// The official worklet-event mapping (types/main-thread/events.d.ts) derives
// `main-thread:bind*` keys from LynxEventPropsBase, which omits the scroll
// family — so `main-thread:bindscroll` & co. are missing. Derive them from
// the scroll event names with the same handler types as ScrollViewProps'
// bind* counterparts.
//
// Events use the Lynx bind* names exclusively: a lynx event is not a DOM
// event (different propagation and event object), so DOM-style `on*` aliases
// are intentionally not declared (and not translated at runtime either).
type WorkletScrollEventNames
  = | 'Scroll'
    | 'ScrollEnd'
    | 'ScrollToUpper'
    | 'ScrollToLower'
    | 'ContentSizeChanged'

type WorkletScrollEvents = {
  [N in WorkletScrollEventNames as `main-thread:bind${Lowercase<N>}`]?: ScrollViewProps[`bind${Lowercase<N>}`]
}

declare module '@lynx-js/types' {
  interface StandardProps {
    'main-thread:ref'?: MainThreadRef<unknown>
    // Worklet-bound event namespace beyond the scroll family (Sheet gestures).
    // Handler payloads are plain event objects; typed loosely to avoid the
    // minified official event type names.
    'main-thread:bindtouchstart'?: (event: any) => void
    'main-thread:bindtouchmove'?: (event: any) => void
    'main-thread:bindtouchend'?: (event: any) => void
    'main-thread:bindtouchcancel'?: (event: any) => void
    'main-thread:bindlayoutchange'?: (event: any) => void
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

    /**
     * Allow any children (loose check, same intent as Solid's
     * `ElementChildrenAttribute`), plus Solid's ref callback seam.
     */
    interface SolidLynxChildren {
      children?: unknown
      ref?: (el: unknown) => void
    }

    interface IntrinsicElements {
      'component': ComponentProps & SolidLynxChildren
      'image': ImageProps & SolidLynxChildren
      'inline-image': ImageProps & SolidLynxChildren
      'inline-text': TextProps & SolidLynxChildren
      'inline-truncation': NoProps & SolidLynxChildren
      'list': ListProps & SolidLynxChildren
      'list-item': ListItemProps & SolidLynxChildren
      'list-row': StandardProps & SolidLynxChildren
      'page': PageProps & SolidLynxChildren
      'scroll-view': ScrollViewProps & SolidLynxChildren
      'text': TextProps & SolidLynxChildren
      'view': ViewProps & SolidLynxChildren
      'svg': StandardProps & { content?: string } & SolidLynxChildren
      'raw-text': (StandardProps & { text: number | string }) & SolidLynxChildren
      'input': InputProps & SolidLynxChildren
      'textarea': TextAreaProps & SolidLynxChildren
    }

    interface ElementChildrenAttribute {
      children: {}
    }
  }
}
/* eslint-enable ts/no-namespace, ts/no-empty-object-type */

export {}
