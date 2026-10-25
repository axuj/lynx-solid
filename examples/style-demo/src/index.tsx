import { render } from '@lynx-solid/runtime'
import { createSignal } from 'solid-js'
import './demo.css'

function Section(props: { title: string, hint: string }) {
  return (
    <view class="sec">
      <text class="sec-title">{props.title}</text>
      <text class="sec-hint">{props.hint}</text>
    </view>
  )
}

function App() {
  const weight = () => '700' as const
  const style = () => 'italic' as const
  const [hot, setHot] = createSignal(false)
  const [n, setN] = createSignal(0)
  return (
    <scroll-view class="page">
      <text class="subtitle-copy">Style Demo</text>

      {/* 1 ─ style sources */}
      <Section
        title="1 · Style sources"
        hint="object / string / dynamic / class — each line matches its label"
      />
      <text style={{ fontStyle: 'italic', fontSize: '40px', fontWeight: 'bold' }}>
        object → italic 40 bold
      </text>
      <text style="font-style: italic; font-size: 28px; color: #cc0000">
        kebab string → italic 28 red
      </text>
      <text style={{ fontWeight: weight(), color: '#0066cc' }}>
        dynamic weight → 700 blue
      </text>
      <text class="slant">class .slant → italic blue bg</text>
      <text style={{ fontStyle: style() }}>dynamic italic → italic</text>

      {/* 2 ─ invalidation */}
      <Section
        title="2 · Descendant invalidation"
        hint="tap box: ON = red bold 18 · OFF = gray 16 — selector re-matches"
      />
      <view class={hot() ? 'inv-root inv-hot' : 'inv-root'} bindtap={() => setHot(v => !v)}>
        <text class="inv-child">
          {hot() ? 'ON — tap for OFF' : 'OFF — tap for ON'}
        </text>
      </view>

      {/* 3 ─ inheritance (A/B: this bundle vs lynx-noinherit) */}
      <Section
        title="3 · enableCSSInheritance (A/B)"
        hint="inherit ON bundle → green italic 40 · noinherit bundle → default"
      />
      <view class="inherit-root">
        <text>child inherits parent font-* ?</text>
      </view>

      {/* 4 ─ fold: bare static text → parent text attr */}
      <Section
        title="4 · Fold bare static text"
        hint="row 1 empty on device = engine rejects view.text (expected) · rows 2–3 show"
      />
      <view class="fold-row">1 bare view text (may be empty)</view>
      <view class="fold-row">
        <text>2 nested text control (shows)</text>
      </view>
      <text class="fold-row">3 text tag fold (shows)</text>

      {/* 5 ─ raw-text runs inherit parent font-* */}
      <Section
        title="5 · Raw-text inherits parent font"
        hint="both rows fully 36px green bold · tap row 1 to increment"
      />
      <text class="raw-row" bindtap={() => setN(v => v + 1)}>
        count:
        {' '}
        {n()}
        {' '}
        (tap)
      </text>
      <text class="raw-row">
        A
        {n()}
        B mixed siblings all 36px
      </text>
    </scroll-view>
  )
}

render(() => <App />)
