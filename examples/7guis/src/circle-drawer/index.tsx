import { render } from '@lynx-solid/runtime'
import { createMemo, createSignal, For, Show } from 'solid-js'

interface Circle {
  id: number
  x: number
  y: number
  r: number
}

const sliderWidth = 200 // slider track width in px
const minRadius = 5
const maxRadius = 150

const DOUBLE_TAP_DELAY = 300 // ms

let nextId = 0

function App() {
  const [history, setHistory] = createSignal<Circle[][]>([[]])
  const [historyIndex, setHistoryIndex] = createSignal(0)
  const [circles, setCircles] = createSignal<Circle[]>([])
  const [selectedId, setSelectedId] = createSignal(-1)
  const [showModal, setShowModal] = createSignal(false)

  const [lastTapTime, setLastTapTime] = createSignal(0)
  const [lastTapId, setLastTapId] = createSignal(-1)
  const [isDragging, setIsDragging] = createSignal(false)

  const selectedCircle = createMemo(() => {
    return circles().find(c => c.id === selectedId())
  })

  const setSliderValue = (val: number): void => {
    const r = Math.max(minRadius, Math.min(maxRadius, val))
    setCircles(prev => prev.map(c => c.id === selectedId() ? { ...c, r } : c))
  }

  function onCanvasTap(e: { detail?: { x?: number, y?: number }, touches?: Array<{ pageX?: number, pageY?: number }> }): void {
    if (showModal()) {
      closeModal()
      return
    }

    // Tap coordinates are relative to the full view.
    const x = e.detail?.x ?? e.touches?.[0]?.pageX ?? 0
    const y = e.detail?.y ?? e.touches?.[0]?.pageY ?? 0

    const hit = [...circles()].reverse().find((c) => {
      const dx = c.x - x
      const dy = c.y - y
      return Math.sqrt(dx * dx + dy * dy) <= c.r
    })

    if (hit) {
      handleCircleTap(hit.id)
    }
    else {
      setCircles(prev => [...prev, { id: nextId++, x, y, r: 30 }])
      setSelectedId(-1)
      push()
    }
  }

  function handleCircleTap(circleId: number): void {
    const now = Date.now()
    const timeSinceLastTap = now - lastTapTime()

    if (lastTapId() === circleId && timeSinceLastTap < DOUBLE_TAP_DELAY) {
      setShowModal(true)
      setLastTapId(-1)
      setLastTapTime(0)
    }
    else {
      setSelectedId(circleId)
      setLastTapId(circleId)
      setLastTapTime(now)
    }
  }

  function closeModal(): void {
    if (showModal()) {
      setShowModal(false)
      push()
    }
  }

  function updateSliderFromTouch(e: { touches?: Array<{ pageX?: number }>, changedTouches?: Array<{ pageX?: number }> }): void {
    const touch = e.touches?.[0] ?? e.changedTouches?.[0]
    if (!touch)
      return

    const trackLeft = (globalThis.window?.innerWidth ?? 375) / 2 - sliderWidth / 2
    const relativeX = (touch.pageX ?? 0) - trackLeft
    const percentage = Math.max(0, Math.min(1, relativeX / sliderWidth))
    setSliderValue(minRadius + percentage * (maxRadius - minRadius))
  }

  function push(): void {
    const snapshot = circles().map(c => ({ ...c }))
    const idx = historyIndex() + 1
    setHistory(prev => [...prev.slice(0, idx), snapshot])
    setHistoryIndex(idx)
  }

  function undo(): void {
    if (historyIndex() > 0) {
      const idx = historyIndex() - 1
      setCircles(history()[idx].map(c => ({ ...c })))
      setHistoryIndex(idx)
      setSelectedId(-1)
      setShowModal(false)
    }
  }

  function redo(): void {
    if (historyIndex() < history().length - 1) {
      const idx = historyIndex() + 1
      setCircles(history()[idx].map(c => ({ ...c })))
      setHistoryIndex(idx)
      setSelectedId(-1)
      setShowModal(false)
    }
  }

  const fillWidth = createMemo(() =>
    (((selectedCircle()?.r ?? minRadius) - minRadius) / (maxRadius - minRadius)) * sliderWidth,
  )

  return (
    <view
      style={{ width: '100%', height: '100vh', minHeight: '400px', backgroundColor: '#f0f0f0', position: 'relative' }}
      bindtap={onCanvasTap}
    >
      <Show when={circles().length === 0}>
        <text
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#bbb',
            fontSize: '14px',
            textAlign: 'center',
          }}
        >
          Tap to draw circles
        </text>
      </Show>

      {/* Circles — catchtap stops propagation to the canvas natively */}
      <For each={circles()}>
        {circle => (
          <view
            style={{
              position: 'absolute',
              left: `${circle.x - circle.r}px`,
              top: `${circle.y - circle.r}px`,
              width: `${circle.r * 2}px`,
              height: `${circle.r * 2}px`,
              borderRadius: `${circle.r}px`,
              backgroundColor: circle.id === selectedId() ? '#0077ff' : '#fff',
              borderWidth: circle.id === selectedId() ? '3px' : '1px',
              borderColor: circle.id === selectedId() ? '#0055cc' : '#333',
            }}
            catchtap={() => handleCircleTap(circle.id)}
          />
        )}
      </For>

      <view style={{ position: 'absolute', top: '10px', left: '0px', right: '0px', display: 'flex', flexDirection: 'row', gap: '8px', justifyContent: 'center' }}>
        <view
          style={{ padding: '6px 16px', backgroundColor: historyIndex() > 0 ? '#0077ff' : '#ccc', borderRadius: '6px' }}
          catchtap={undo}
        >
          <text style={{ color: '#fff', fontSize: '14px' }}>Undo</text>
        </view>
        <view
          style={{ padding: '6px 16px', backgroundColor: historyIndex() < history().length - 1 ? '#0077ff' : '#ccc', borderRadius: '6px' }}
          catchtap={redo}
        >
          <text style={{ color: '#fff', fontSize: '14px' }}>Redo</text>
        </view>
      </view>

      <Show when={circles().length > 0 && !showModal()}>
        <text
          style={{ position: 'absolute', bottom: '20px', left: '0px', right: '0px', textAlign: 'center', color: '#666', fontSize: '12px' }}
        >
          Double-tap a circle to adjust radius
        </text>
      </Show>

      <Show when={showModal()}>
        <view
          style={{
            position: 'absolute',
            top: '0px',
            left: '0px',
            right: '0px',
            bottom: '0px',
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '100',
          }}
          catchtap={closeModal}
        >
          {/* Modal Content — catchtap keeps taps inside from reaching the overlay */}
          <view
            style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '24px 32px', alignItems: 'center', minWidth: '280px' }}
            catchtap={() => {}}
          >
            <text style={{ fontSize: '18px', fontWeight: 'bold', color: '#333', marginBottom: '16px' }}>
              Adjust Radius
            </text>

            <text style={{ fontSize: '24px', fontWeight: 'bold', color: '#0077ff', marginBottom: '20px' }}>
              {Math.round(selectedCircle()?.r ?? 0)}
              px
            </text>

            <view
              style={{ width: `${sliderWidth}px`, height: '6px', backgroundColor: '#e0e0e0', borderRadius: '3px', position: 'relative' }}
              bindtouchstart={(e) => {
                setIsDragging(true)
                updateSliderFromTouch(e)
              }}
              bindtouchmove={(e) => {
                if (isDragging())
                  updateSliderFromTouch(e)
              }}
              bindtouchend={() => setIsDragging(false)}
            >
              <view
                style={{ position: 'absolute', left: '0px', top: '0px', height: '6px', width: `${fillWidth()}px`, backgroundColor: '#0077ff', borderRadius: '3px' }}
              />
              <view
                style={{
                  position: 'absolute',
                  top: '-7px',
                  left: `${fillWidth() - 10}px`,
                  width: '20px',
                  height: '20px',
                  backgroundColor: '#0077ff',
                  borderRadius: '10px',
                  borderWidth: '2px',
                  borderColor: '#fff',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                }}
              />
            </view>

            <view style={{ width: `${sliderWidth}px`, display: 'flex', flexDirection: 'row', justifyContent: 'space-between', marginTop: '8px' }}>
              <text style={{ fontSize: '12px', color: '#999' }}>
                {minRadius}
                px
              </text>
              <text style={{ fontSize: '12px', color: '#999' }}>
                {maxRadius}
                px
              </text>
            </view>

            <view
              style={{ marginTop: '24px', padding: '10px 32px', backgroundColor: '#0077ff', borderRadius: '6px' }}
              bindtap={closeModal}
            >
              <text style={{ color: '#fff', fontSize: '16px', fontWeight: 'bold' }}>Done</text>
            </view>
          </view>
        </view>
      </Show>
    </view>
  )
}

render(() => <App />)
