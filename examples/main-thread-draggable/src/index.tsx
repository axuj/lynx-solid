import type { ScrollEvent, ViewProps } from '@lynx-js/types'
import { render, useMainThreadRef } from '@lynx-solid/runtime'
/**
 * Main Thread Script demo — direct port of the official lynx-examples
 * main-thread-draggable (bindscroll-driven), on the web host.
 *
 * One scroll-view binds BOTH paths:
 *   - bindscroll (BG):             handler → setState → renderer → ops → MT
 *   - main-thread:bindscroll (MT): handler runs on the MT, the MT ref
 *     (`main-thread:ref`) resolves to the live element, and
 *     setStyleProperty mutates it directly — zero ops.
 *     Official double-marking: `main-thread:` event namespace + the
 *     `'main thread'` directive as a statement of the handler body.
 */
import { createSignal } from 'solid-js'

const DEFAULT_POS = { x: 0, y: 500 }

function BackgroundDraggable(props: { size: number, posStyle: { x: number, y: number } }) {
  return (
    <view style={{
      height: `${props.size}px`,
      width: `${props.size}px`,
      background: 'lightskyblue',
      transform: `translate(${props.posStyle.x}px, ${props.posStyle.y}px)`,
    }}
    >
      <text>BGDraggable</text>
    </view>
  )
}

function MainThreadDraggable(props: ViewProps & { size: number }) {
  return (
    <view
      main-thread:ref={props['main-thread:ref']}
      style={{
        height: `${props.size}px`,
        width: `${props.size}px`,
        background: 'lightskyblue',
        transform: `translate(${DEFAULT_POS.x}px, ${DEFAULT_POS.y}px)`,
      }}
    >
      <text>MTDraggable</text>
    </view>
  )
}

function App() {
  const mtDraggableRef = useMainThreadRef<{ setStyleProperty: (name: string, value: string) => void } | null>(null)
  const [posStyle, setPosStyle] = createSignal(DEFAULT_POS)

  const onBtsScroll = (event: ScrollEvent) => {
    const scrollTop = event.detail.scrollTop
    setPosStyle({ ...DEFAULT_POS, y: DEFAULT_POS.y - scrollTop })
  }

  const onMtsScroll = (event: ScrollEvent) => {
    'main thread'
    const scrollTop = event.detail.scrollTop
    const newPos = { ...DEFAULT_POS, y: DEFAULT_POS.y - scrollTop }
    mtDraggableRef.current?.setStyleProperty('transform', `translate(${newPos.x}px, ${newPos.y}px)`)
  }

  return (
    <view style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: 'white' }}>
      <view style={{ display: 'linear', linearDirection: 'row', width: '100%', height: '100%' }}>
        <scroll-view
          id="scroll"
          bindscroll={onBtsScroll}
          main-thread:bindscroll={onMtsScroll}
          scroll-y
          style={{ display: 'linear', linearDirection: 'row', width: '50%', height: '100%' }}
        >
          <view style={{ background: 'yellow', width: '100%', height: '500px' }} />
          <view style={{ background: 'lightskyblue', width: '100%', height: '100px' }} />
          <view style={{ background: 'yellow', width: '100%', height: '1000px' }} />
        </scroll-view>
        <view style={{ width: '50%', height: '100%', display: 'linear', linearDirection: 'row' }}>
          <MainThreadDraggable size={100} main-thread:ref={mtDraggableRef} />
          <BackgroundDraggable size={100} posStyle={posStyle()} />
        </view>
      </view>
    </view>
  )
}

render(() => <App />)
