/**
 * Public payload types for worklet events the official `@lynx-js/types`
 * package does not describe for the main thread.
 *
 * Kept out of `jsx-runtime.ts` so `@lynx-solid/runtime` can export the type
 * without pulling the global JSX augmentation into every consumer.
 */
import type { Element } from '@lynx-js/types/main-thread'

/**
 * MT scroll payload. The background `ScrollEvent` family derives from
 * `BaseEvent`, whose `target`/`currentTarget` are the background `Target`;
 * a worklet handler runs with the live MT element instead.
 */
export type MainThreadScrollEvent<T> = Omit<T, 'target' | 'currentTarget'> & {
  target: Element
  currentTarget: Element
}
