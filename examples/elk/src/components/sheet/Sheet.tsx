import type { SheetGestureSource } from './gesture'
import { registerBgFunction, runOnBackground, useMainThreadRef } from '@lynx-solid/runtime'
import { createMemo, Show, untrack } from 'solid-js'
import {
  resolveSheetDrag,
  sheetDismissThreshold,

  sheetOpenProgress,
  sheetReleaseVelocity,
  shouldClaimSheetGesture,
  shouldDismissSheet,
  smoothSheetVelocity,
} from './gesture' with { runtime: 'shared' }

interface TouchPoint {
  clientX?: number
  clientY?: number
}

interface SheetTouchEvent {
  detail?: { x?: number, y?: number }
  touches?: TouchPoint[]
}

interface SheetScrollEvent {
  detail?: { scrollTop?: number }
}

interface SheetLayoutEvent {
  detail?: { height?: number }
  params?: { height?: number }
}

interface MainThreadElement {
  setStyleProperty?: (name: string, value: string) => void
  setAttribute?: (name: string, value: boolean) => void
}

export function Sheet(props: {
  open: boolean
  onClose: () => void
  bottomInset?: number
  topInset?: number
  dismissDistance?: number
  children?: unknown
}) {
  const surfaceRef = useMainThreadRef<MainThreadElement | null>(null)
  const backdropRef = useMainThreadRef<MainThreadElement | null>(null)
  const panelRef = useMainThreadRef<MainThreadElement | null>(null)
  const surfaceHeightRef = useMainThreadRef(0)
  const touchStartXRef = useMainThreadRef(0)
  const touchStartYRef = useMainThreadRef(0)
  const touchStartTranslationRef = useMainThreadRef(0)
  const lastTouchYRef = useMainThreadRef(0)
  const lastTouchTimeRef = useMainThreadRef(0)
  const translationRef = useMainThreadRef(0)
  const velocityRef = useMainThreadRef(0)
  const scrollTopRef = useMainThreadRef(0)
  const scrollTopAtTouchStartRef = useMainThreadRef(0)
  const gestureSourceRef = useMainThreadRef<SheetGestureSource>('content')
  const gestureLockedRef = useMainThreadRef(false)
  const gestureRejectedRef = useMainThreadRef(false)
  const settleTimerRef = useMainThreadRef(0)
  const animationGenerationRef = useMainThreadRef(0)
  const panelScrollEnabledRef = useMainThreadRef(true)
  const backdropOpacityRef = useMainThreadRef(-1)

  // The worklet cannot capture the BG onClose closure — register it and pass
  // the opaque ref through the worklet context instead.
  const closeRef = registerBgFunction(() => untrack(() => props.onClose()))
  // Worklet closures must stay JSON-serializable: extract the number so the
  // whole `props` object (holding functions) never enters the context.
  const dismissDistance = untrack(() => props.dismissDistance) ?? 0

  const layerStyle = createMemo(() => ({ bottom: `${props.bottomInset ?? 0}px` }))
  const surfaceStyle = createMemo(() => ({
    height: `calc(100% - ${props.topInset ?? 0}px)`,
  }))

  function requestClose() {
    props.onClose()
  }

  function touchX(event: SheetTouchEvent): number {
    'main thread'
    return event.detail?.x ?? event.touches?.[0]?.clientX ?? 0
  }

  function touchY(event: SheetTouchEvent): number {
    'main thread'
    return event.detail?.y ?? event.touches?.[0]?.clientY ?? 0
  }

  function setMotionTransition(surfaceValue: string, backdropValue: string) {
    'main thread'
    surfaceRef.current?.setStyleProperty?.('transition', surfaceValue)
    backdropRef.current?.setStyleProperty?.('transition', backdropValue)
  }

  function setPanelScrollEnabled(enabled: boolean) {
    'main thread'
    if (panelScrollEnabledRef.current === enabled)
      return
    panelScrollEnabledRef.current = enabled
    panelRef.current?.setAttribute?.('enable-scroll', enabled)
  }

  function applySheetMotion(translation: number) {
    'main thread'
    const sheetSize = surfaceHeightRef.current > 0
      ? surfaceHeightRef.current
      : 640
    const progress = sheetOpenProgress(translation, sheetSize)
    const opacity = Math.round(progress * 100) / 100

    translationRef.current = translation
    surfaceRef.current?.setStyleProperty?.(
      'transform',
      `translateY(${translation}px)`,
    )
    if (opacity !== backdropOpacityRef.current) {
      backdropOpacityRef.current = opacity
      backdropRef.current?.setStyleProperty?.('opacity', String(opacity))
    }
  }

  function cancelSettle() {
    'main thread'
    animationGenerationRef.current += 1
    if (settleTimerRef.current !== 0) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = 0
    }
  }

  function resetGestureState() {
    'main thread'
    setPanelScrollEnabled(true)
    gestureLockedRef.current = false
    gestureRejectedRef.current = false
    velocityRef.current = 0
  }

  function finishSettle(target: number, dismiss: boolean, generation: number) {
    'main thread'
    if (generation !== animationGenerationRef.current)
      return

    settleTimerRef.current = 0
    velocityRef.current = 0
    applySheetMotion(target)
    resetGestureState()

    if (dismiss) {
      // The <Show> unmounts the DOM on close, but numeric refs live on the
      // component instance and survive remount. Without resetting them, the
      // next open starts from the stale dismiss translation (~sheetSize) and
      // the first claimed drag flings the fresh surface off-screen instantly.
      translationRef.current = 0
      backdropOpacityRef.current = -1
      scrollTopRef.current = 0
      runOnBackground(closeRef)()
    }
    else {
      setMotionTransition('none', 'none')
    }
  }

  function animateSheetTo(target: number, dismiss: boolean) {
    'main thread'
    cancelSettle()
    const generation = animationGenerationRef.current
    const duration = dismiss ? 320 : 360
    const easing = 'cubic-bezier(0.22, 1, 0.36, 1)'

    setMotionTransition(
      `transform ${duration}ms ${easing}`,
      `opacity ${duration}ms ${easing}`,
    )
    settleTimerRef.current = Number(setTimeout(() => {
      if (generation !== animationGenerationRef.current)
        return

      applySheetMotion(target)
      // Arrow wrapper, never arg-forwarding `setTimeout(fn, ms, ...)` — the
      // on-device PrimJS timer drops extra args, so finishSettle would receive
      // undefined generation and bail before ever closing (icon stuck on X).
      // The imported two-arg timer makes a forwarded form fail typecheck.
      // Number() keeps the numeric device id: the node-flavored Timeout only
      // exists in the compile-time view (leaked in via @types/ws), while the
      // ref must stay a clone-safe number across threads.
      settleTimerRef.current = Number(setTimeout(() => finishSettle(
        target,
        dismiss,
        generation,
      ), duration))
    }, 16))
  }

  function beginGesture(source: SheetGestureSource, event: SheetTouchEvent) {
    'main thread'
    if (settleTimerRef.current !== 0) {
      gestureRejectedRef.current = true
      return
    }

    const x = touchX(event)
    const y = touchY(event)
    touchStartXRef.current = x
    touchStartYRef.current = y
    touchStartTranslationRef.current = translationRef.current
    scrollTopAtTouchStartRef.current = scrollTopRef.current
    lastTouchYRef.current = y
    lastTouchTimeRef.current = Date.now()
    gestureSourceRef.current = source
    resetGestureState()
  }

  function handleHandleTouchStart(event: SheetTouchEvent) {
    'main thread'
    beginGesture('handle', event)
  }

  function handleContentTouchStart(event: SheetTouchEvent) {
    'main thread'
    beginGesture('content', event)
  }

  function handlePanelScroll(event: SheetScrollEvent) {
    'main thread'
    scrollTopRef.current = event.detail?.scrollTop ?? 0
  }

  function handleSurfaceLayout(event: SheetLayoutEvent) {
    'main thread'
    surfaceHeightRef.current = event.detail?.height ?? event.params?.height ?? 0
  }

  function handleTouchMove(event: SheetTouchEvent) {
    'main thread'
    if (gestureRejectedRef.current)
      return

    const x = touchX(event)
    const y = touchY(event)
    const deltaX = x - touchStartXRef.current
    const deltaY = y - touchStartYRef.current

    if (!gestureLockedRef.current) {
      if (shouldClaimSheetGesture(
        gestureSourceRef.current,
        deltaX,
        deltaY,
        scrollTopAtTouchStartRef.current,
      )) {
        cancelSettle()
        setMotionTransition('none', 'none')
        setPanelScrollEnabled(false)
        gestureLockedRef.current = true
      }
      else if (deltaX * deltaX + deltaY * deltaY >= 64) {
        gestureRejectedRef.current = true
        return
      }
    }

    if (!gestureLockedRef.current)
      return

    const now = Date.now()
    velocityRef.current = smoothSheetVelocity(
      velocityRef.current,
      y - lastTouchYRef.current,
      now - lastTouchTimeRef.current,
    )
    lastTouchYRef.current = y
    lastTouchTimeRef.current = now

    const translation = resolveSheetDrag(
      touchStartTranslationRef.current + deltaY,
    )
    applySheetMotion(translation)
  }

  function handleTouchEnd() {
    'main thread'
    if (!gestureLockedRef.current) {
      resetGestureState()
      return
    }

    const downwardDistance = Math.max(0, translationRef.current)
    const sheetSize = surfaceHeightRef.current > 0
      ? surfaceHeightRef.current
      : 640
    const dismiss = shouldDismissSheet(
      downwardDistance,
      sheetReleaseVelocity(
        velocityRef.current,
        Date.now() - lastTouchTimeRef.current,
      ),
      sheetDismissThreshold(sheetSize, dismissDistance),
    )
    const dismissTarget = sheetSize + 32
    animateSheetTo(dismiss ? dismissTarget : 0, dismiss)
    setPanelScrollEnabled(true)
    gestureLockedRef.current = false
    gestureRejectedRef.current = false
  }

  function handleTouchCancel() {
    'main thread'
    if (gestureLockedRef.current) {
      setPanelScrollEnabled(true)
      animateSheetTo(0, false)
    }
    else {
      resetGestureState()
    }
  }

  return (
    <Show when={props.open}>
      <view class="sheet-layer" style={layerStyle()}>
        <view
          class="sheet-backdrop"
          main-thread:ref={backdropRef}
          bindtap={requestClose}
        />
        <view class="sheet-surface-transition" style={surfaceStyle()}>
          <view
            class="sheet-surface"
            main-thread:ref={surfaceRef}
            main-thread:bindlayoutchange={handleSurfaceLayout}
          >
            <view class="sheet-rubber-fill" />
            <view
              class="sheet-handle-hit-area"
              main-thread:bindtouchstart={handleHandleTouchStart}
              main-thread:bindtouchmove={handleTouchMove}
              main-thread:bindtouchend={handleTouchEnd}
              main-thread:bindtouchcancel={handleTouchCancel}
            >
              <view class="sheet-handle" />
            </view>
            <scroll-view
              class="sheet-panel"
              scroll-orientation="vertical"
              bounces
              main-thread:ref={panelRef}
              main-thread:bindscroll={handlePanelScroll}
              main-thread:bindtouchstart={handleContentTouchStart}
              main-thread:bindtouchmove={handleTouchMove}
              main-thread:bindtouchend={handleTouchEnd}
              main-thread:bindtouchcancel={handleTouchCancel}
            >
              {props.children}
            </scroll-view>
          </view>
        </view>
      </view>
    </Show>
  )
}
