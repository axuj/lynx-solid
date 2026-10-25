/**
 * Compile-stage tests for the fork dom pipeline: the BG
 * module must register templates with refs anchors (no HTML template
 * strings), and the extracted metadata must carry the MT createCode with
 * DFS offsets matching the skeleton tree.
 */

import { describe, expect, it } from 'vitest'
import { compileDomModule } from '../../packages/compiler/src/dom-compile'

const STATIC_SRC = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { createSignal } from 'solid-js'
const [x, setX] = createSignal(0)
function App() {
  return (
    <view class="app" data-k="v">
      <text>hello</text>
      <text class={x() ? 'a' : 'b'}>{x()}</text>
      <text>tail</text>
    </view>
  )
}
renderer.render(() => <App />, createPageRoot())
`

describe('lynx dom compile', () => {
  it('emits registerTemplate with refs anchors, no HTML template strings', () => {
    const { code, templates } = compileDomModule(STATIC_SRC)
    expect(code).not.toContain('_$template(`')
    // ids are content hashes (fnv1a) — assert the baked literal matches the
    // extracted metadata instead of a specific number
    expect(code).toContain(`_$registerTemplate(${templates[0]!.id},`)
    expect(code).toMatch(/registerTemplate as _\$registerTemplate/)
    // instance refs: refs[0] is the static text anchor, refs[1] the dynamic text
    // element — a sole dynamic text child rides that element's `text` attribute
    expect(code).toMatch(/_\$setAttribute\(_el\$, _el\$3, "text", t\)/)
    expect(code).toContain('_el$.refs[0]')
    expect(code).toContain('_el$.refs[1]')
    expect(templates).toHaveLength(1)
  })

  it('extracts createCode with static attrs and DFS-aligned anchors', () => {
    const { code, templates } = compileDomModule(STATIC_SRC)
    const t = templates[0]!
    // content-hash id, deterministically derived from the createCode
    expect(t.id).toBeGreaterThan(0)
    expect(code).toContain(`registerTemplate(${t.id},`)
    // view(0) text-hello(1) text-dyn(2) text-tail(3) — 4 created nodes
    // (single static text children fold into the text attribute)
    expect(t.nodeCount).toBe(4)
    expect(t.anchors).toEqual([
      { index: 0, offset: 1 },
      { index: 1, offset: 2 },
    ])
    expect(t.createCode).toContain('P.create("view")')
    expect(t.createCode).toContain('P.cls(e0,"app")')
    expect(t.createCode).toContain('P.prop(e0,"data-k","v")')
    expect(t.createCode).toContain('P.prop(e1,"text","hello")')
    expect(t.createCode).toContain('P.prop(e3,"text","tail")')
    expect(t.createCode).toContain('P.append(e0,e1)')
  })

  it('compiles dynamic attrs into diffed effect setters', () => {
    const { code } = compileDomModule(STATIC_SRC)
    expect(code).toContain('effect as _$effect')
    expect(code).toContain('className as _$className')
    // class + text ride ONE effect (both are attribute slots now), each setter
    // guarded by its own change predicate
    expect(code).toMatch(/_\$effect\(\(\) => \(\{/)
    expect(code).toContain('_$className(_el$3, e, _p$?.e)')
    expect(code).toContain('_$setAttribute(_el$, _el$3, "text", t)')
    expect(code).toContain('t !== _p$?.t &&')
  })

  it('strips TypeScript syntax', () => {
    const { code } = compileDomModule(
      `const f = (x: number): string => String(x)
function App() { return <view><text>{f(1)}</text></view> }`,
    )
    expect(code).not.toContain(': number')
    expect(code).not.toContain(': string')
  })

  it('splits Show children into an independent template with marker anchor', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { Show, createSignal } from 'solid-js'
const [on, setOn] = createSignal(true)
function App() {
  return (
    <view>
      <text>static</text>
      <Show when={on()}><text>shown</text></Show>
      <text>tail</text>
    </view>
  )
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    expect(templates).toHaveLength(2)
    // template 2 (static skeleton): refs[0] = static text, refs[1] = tail (marker)
    const staticTpl = templates[1]!
    expect(staticTpl.anchors).toEqual([
      { index: 0, offset: 1 },
      { index: 1, offset: 2 },
    ])
    expect(code).toMatch(/_\$insert\(_el\$, _el\$, _\$createComponent\(Show,/)
    expect(code).toContain('_el$.refs[1]')
  })

  it('treats onX event props as plain attributes (setAttribute, no $$/delegateEvents)', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { createSignal } from 'solid-js'
const [count, setCount] = createSignal(0)
function App() {
  const handle = () => setCount(count() + 1)
  return (
    <view onClick={handle} bindtap={() => setCount(count() + 1)}>
      <text>{count()}</text>
    </view>
  )
}
renderer.render(() => <App />, createPageRoot())
`
    const { code } = compileDomModule(src)
    expect(code).not.toContain('$$click')
    expect(code).not.toContain('addEventListener')
    expect(code).not.toContain('delegateEvents')
    expect(code).toMatch(/_\$setAttribute\([^)]+, "onClick", handle\)/)
    expect(code).toMatch(/_\$setAttribute\([^)]+, "bindtap",/)
  })

  it('splits For children into an independent item template with dynamic-text anchor', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { For, createSignal } from 'solid-js'
const [items, setItems] = createSignal(['a', 'b'])
function App() {
  return (
    <view>
      <For each={items()}>
        {(item) => (
          <view class="row"><text>{item}</text></view>
        )}
      </For>
    </view>
  )
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    expect(templates).toHaveLength(2)
    // container view skeleton — no dynamic content inside
    expect(templates[0]).toMatchObject({ nodeCount: 1, anchors: [] })
    // item template: view(row) + text with the dynamic text anchored
    expect(templates[1]!.anchors).toEqual([{ index: 0, offset: 1 }])
    expect(code).toContain('createComponent(For,')
    expect(code).toContain('.refs[0]')
  })

  it('keeps static style in the skeleton and compiles dynamic style to a style effect', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { createSignal } from 'solid-js'
const [on, setOn] = createSignal(false)
function App() {
  return (
    <view style={{ color: on() ? 'red' : 'blue', width: '100px' }}>
      <text>x</text>
    </view>
  )
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    expect(templates).toHaveLength(1)
    const t = templates[0]!
    // Static width is hoisted as an object (engine object form accepts camelCase;
    // string form only accepts kebab and would break fontStyle/fontSize/fontWeight).
    expect(t.createCode).toContain('P.style(e0,{"width":"100px"})')
    expect(t.createCode).not.toContain('color')
    expect(code).toContain('style as _$style')
    expect(code).toContain('effect as _$effect')
    expect(code).toMatch(/on\(\) \? 'red' : 'blue'/)
  })

  it('never hoists spread props into the skeleton (runtime _$spread)', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
const props = { class: 'a', id: 'b' }
function App() {
  return <view {...props}><text>x</text></view>
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    expect(templates).toHaveLength(1)
    expect(templates[0]!.createCode).not.toContain('P.cls(')
    expect(templates[0]!.createCode).not.toContain('"id"')
    expect(code).toContain('spread as _$spread')
    expect(code).toContain('_$spread(_el$, props, true)')
  })

  it('splits static and dynamic text of a mixed <text> into skeleton + refs anchor', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { createSignal } from 'solid-js'
const [count, setCount] = createSignal(0)
function App() {
  return <text>count: {count()}</text>
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    expect(templates).toHaveLength(1)
    const t = templates[0]!
    expect(t.nodeCount).toBe(2)
    expect(t.anchors).toEqual([{ index: 0, offset: 1 }])
    // parent <text> element + raw-text run for the static sibling
    expect(t.createCode).toContain('P.create("text")')
    expect(t.createCode).toContain('P.rawText("count: ")')
    expect(t.createCode).toContain('P.append(e0,e1)')
    expect(code).toContain('_el$.refs[0]')
    expect(code).toContain('insert as _$insert')
  })

  it('folds a single static text child of <text> into the text attribute', () => {
    const { templates } = compileDomModule(
      `function App() { return <text style="font-style:italic">hello</text> }`,
    )
    const t = templates[0]!
    expect(t.nodeCount).toBe(1)
    expect(t.createCode).toContain('P.prop(e0,"text","hello")')
    expect(t.createCode).not.toContain('P.append(')
  })

  it('sole dynamic <text> child rides the text attribute; multi-child keeps insert', () => {
    const dyn = compileDomModule(
      `function App(props: any) { return <text>{props.x}</text> }`,
    )
    // the value stays dynamic (an effect setter on the element) — never a baked
    // static attribute, so ReactLynx's "no static fold of dynamic content" holds
    expect(dyn.templates[0]!.createCode).not.toContain('P.prop(')
    expect(dyn.code).toContain('_$setAttribute(')
    expect(dyn.code).not.toContain('_$insert(')
    expect(dyn.templates[0]!.anchors).toEqual([])
    const mixed = compileDomModule(
      `function App(props: any) { return <text>a{props.x}b</text> }`,
    )
    // static siblings become raw-text runs (inherit parent text styles), not a folded attr
    expect(mixed.templates[0]!.createCode).toContain('P.rawText("a")')
    expect(mixed.templates[0]!.createCode).not.toContain('P.prop(e0,"text"')
  })

  it('does not fold when <text> already has an explicit text attribute', () => {
    const { templates } = compileDomModule(
      `function App() { return <text text="kept">child</text> }`,
    )
    // explicit text attr wins the attribute slot; the child stays a raw-text run
    expect(templates[0]!.createCode).toContain('P.prop(e0,"text","kept")')
    expect(templates[0]!.createCode).toContain('P.rawText("child")')
  })

  it('folds bare static text children of <view> into the text attribute (vue-lynx parity)', () => {
    const { templates } = compileDomModule(
      `function App() { return <view>hello</view> }`,
    )
    expect(templates[0]!.createCode).toContain('P.prop(e0,"text","hello")')
    expect(templates[0]!.createCode).not.toContain('P.append(')
  })

  it('extracts a static style string into the skeleton', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  return <view style="width:100%;height:80%"><text>hi</text></view>
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    expect(templates).toHaveLength(1)
    expect(templates[0]!.createCode).toContain('P.style(e0,"width:100%;height:80%")')
    expect(code).not.toContain('_$setStyleProperty')
  })

  it('hoists a fully static style object into the skeleton as an object (not a CSS string)', () => {
    const { templates } = compileDomModule(
      `function App() { return <text style={{ fontStyle: 'italic', fontSize: '40px' }}>hello</text> }`,
    )
    const t = templates[0]!
    expect(t.createCode).toContain('P.style(e0,{"fontStyle":"italic","fontSize":"40px"})')
    expect(t.createCode).not.toContain('fontStyle:italic')
  })

  it('compiles a ternary into independent branch templates selected by memo', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { createSignal } from 'solid-js'
const [on, setOn] = createSignal(true)
function App() {
  return <view>{on() ? <text>a</text> : <text>b</text>}</view>
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    expect(templates).toHaveLength(3)
    expect(templates[0]!.createCode).toContain('P.create("view")')
    expect(templates[1]!.createCode).toContain('P.prop(e0,"text","a")')
    expect(templates[2]!.createCode).toContain('P.prop(e0,"text","b")')
    expect(code).toContain('memo as _$memo')
    expect(code).toMatch(/_c\$\(\) \? _tmpl\$2\(\) : _tmpl\$3\(\)/)
  })

  it('splits nested Show > For into separate templates (deduped view skeleton)', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { Show, For, createSignal } from 'solid-js'
const [on, setOn] = createSignal(true)
const [items, setItems] = createSignal(['a'])
function App() {
  return (
    <view>
      <Show when={on()}>
        <view>
          <For each={items()}>{(item) => <text>{item}</text>}</For>
        </view>
      </Show>
    </view>
  )
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    // outer view and the Show branch view share one skeleton (template dedup);
    // the For item text is the second template
    expect(templates).toHaveLength(2)
    expect(templates[0]!.createCode).toContain('P.create("view")')
    expect(templates[1]!.createCode).toContain('P.create("text")')
    expect(code).toContain('createComponent(Show,')
    expect(code).toContain('createComponent(For,')
    expect(code).toMatch(/_tmpl\$2\(\)/)
  })

  it('splits Switch/Match branches into independent templates', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { Switch, Match, createSignal } from 'solid-js'
const [n, setN] = createSignal(1)
function App() {
  return (
    <view>
      <Switch>
        <Match when={n() === 1}><text>one</text></Match>
        <Match when={n() === 2}><text>two</text></Match>
      </Switch>
    </view>
  )
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    expect(templates).toHaveLength(3)
    expect(templates[0]!.createCode).toContain('P.prop(e0,"text","one")')
    expect(templates[1]!.createCode).toContain('P.prop(e0,"text","two")')
    expect(templates[2]!.createCode).toContain('P.create("view")')
    expect(code).toContain('createComponent(Switch,')
  })

  it('emits event handlers through the dynamic setAttribute path, not the skeleton', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { createSignal } from 'solid-js'
const [count, setCount] = createSignal(0)
function App() {
  const cb = () => setCount(count() + 1)
  return <view bindtap={cb}><text>{count()}</text></view>
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    expect(templates).toHaveLength(1)
    expect(templates[0]!.createCode).not.toContain('bindtap')
    expect(code).toMatch(/_\$setAttribute\(_el\$, _el\$, "bindtap", cb\)/)
    expect(templates[0]!.anchors).toEqual([{ index: 0, offset: 1 }])
  })

  it('workletizes main-thread:bind* handlers carrying the \'main thread\' directive', () => {
    // Official ReactLynx double-marking: `main-thread:` event namespace on
    // the attribute + the `'main thread'` directive in the handler body.
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { createSignal } from 'solid-js'
const [count, setCount] = createSignal(0)
function App() {
  const onScroll = (e) => {
    'main thread'
    count()
  }
  return <view main-thread:bindscroll={onScroll} />
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, worklets } = compileDomModule(src)
    // SWC object shape: handler replaced by `{ _c, _wkltId }`, passed through
    expect(code).toMatch(/_\$setAttribute\([^)]+, "main-thread:bindscroll", onScroll\)/)
    expect(code).toMatch(/_c:\s*\{\s*count[^}]*\}/)
    expect(code).toMatch(/_wkltId:\s*"[0-9a-f]+:[0-9a-f]+:\d+"/)
    expect(worklets.length).toBe(1)
    expect(worklets[0]!.id).toMatch(/^[0-9a-f]+:[0-9a-f]+:\d+$/)
  })

  it('rejects main-thread:bind* handlers without the \'main thread\' directive', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  const onScroll = (e) => e.detail.scrollTop
  return <view main-thread:bindscroll={onScroll} />
}
renderer.render(() => <App />, createPageRoot())
`
    expect(() => compileDomModule(src)).toThrow(/main thread/)
  })

  it('rejects regular bind* handlers marked with the \'main thread\' directive', () => {
    // A main thread function "can and must only run on the main thread" —
    // binding it to a background-dispatch event is a compile error.
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  const onScroll = (e) => {
    'main thread'
    e.detail.scrollTop
  }
  return <view bindscroll={onScroll} />
}
renderer.render(() => <App />, createPageRoot())
`
    expect(() => compileDomModule(src)).toThrow(/main thread/)
  })

  it('accepts the official \'main-thread\' alias as an Element worklet', () => {
    // Same WorkletType::Element, registered as "main-thread" — previously a
    // false-positive compile error on MT bindings and silent BG fallback.
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { createSignal } from 'solid-js'
const [count, setCount] = createSignal(0)
function App() {
  const onScroll = (e) => {
    'main-thread'
    count()
  }
  return <view main-thread:bindscroll={onScroll} />
}
renderer.render(() => <App />, createPageRoot())
`
    const { worklets } = compileDomModule(src)
    expect(worklets.length).toBe(1)
    expect(worklets[0]!.id).toMatch(/^[0-9a-f]+:[0-9a-f]+:\d+$/)
  })

  it('rejects the \'main-thread\' alias on background bindings (was silent)', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  const onScroll = (e) => {
    'main-thread'
    e.detail.scrollTop
  }
  return <view bindscroll={onScroll} />
}
renderer.render(() => <App />, createPageRoot())
`
    expect(() => compileDomModule(src)).toThrow(/main thread/)
  })

  it('rejects worklets capturing bare local functions (would die silently MT-side)', () => {
    // SWC captures free vars into `_c` by reference; a same-module plain
    // function evaporates over JSON and the body calls undefined with zero
    // errors. Fail loud here with the variable name + fixes.
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  const fmt = (y) => \`translateY(\${y}px)\`
  const onMove = (e) => {
    'main thread'
    return fmt(1)
  }
  return <view main-thread:bindtouchmove={onMove} />
}
renderer.render(() => <App />, createPageRoot())
`
    expect(() => compileDomModule(src)).toThrow(/plain function 'fmt'/)
  })

  it('passes shared imports and foreign imports (runtime guard territory)', () => {
    // Shared imports never enter `_c` (SWC skips them); foreign (non-shared)
    // imports can't be judged without resolving the module — the runtime
    // crossing guard names them instead. Neither may fail the build.
    const src = `
import { sharedFn } from './s' with { runtime: 'shared' }
import { foreignFn } from './u'
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  const onTap = (e) => {
    'main thread'
    return sharedFn(1) + foreignFn(2)
  }
  return <view main-thread:bindtap={onTap} />
}
renderer.render(() => <App />, createPageRoot())
`
    expect(() => compileDomModule(src)).not.toThrow()
  })

  it('rejects bare captures inside transitively referenced worklets', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  const fmt = (x) => x
  const inner = () => {
    'main thread'
    return fmt(1)
  }
  const outer = () => {
    'main thread'
    return inner()
  }
  return <view main-thread:bindtap={outer} />
}
renderer.render(() => <App />, createPageRoot())
`
    expect(() => compileDomModule(src)).toThrow(/plain function 'fmt'/)
  })

  it('rejects bare captures in runOnMainThread arguments', () => {
    const src = `
import { runOnMainThread } from '@lynx-solid/runtime'
export function App() {
  const fmt = (x) => x
  const apply = (x) => {
    'main thread'
    return fmt(x)
  }
  const animate = runOnMainThread(apply)
  return animate
}
`
    expect(() => compileDomModule(src)).toThrow(/plain function 'fmt'/)
  })

  it('rejects \'use worklet\' (UI thread) everywhere with a dedicated error', () => {
    const mtSrc = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  const onTap = () => {
    'use worklet'
  }
  return <view main-thread:bindtap={onTap} />
}
renderer.render(() => <App />, createPageRoot())
`
    expect(() => compileDomModule(mtSrc)).toThrow(/UI thread/)
    const bgSrc = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  const onTap = () => {
    'use worklet'
  }
  return <view bindtap={onTap} />
}
renderer.render(() => <App />, createPageRoot())
`
    expect(() => compileDomModule(bgSrc)).toThrow(/UI thread/)
  })

  it('keeps runOnBackground calls as bare-global invocations (official SWC shape)', () => {
    const src = `
import { registerBgFunction, runOnBackground } from '@lynx-solid/runtime'
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  const closeRef = registerBgFunction(() => {})
  const onSwipe = (e) => {
    'main thread'
    runOnBackground(closeRef)(1, 'x')
  }
  return <view main-thread:bindtap={onSwipe} />
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, worklets } = compileDomModule(src)
    // SWC shape: the captured BG function goes to `_jsFn` via a generated
    // transformToWorklet call; the body reads it from this["_jsFn"]
    expect(worklets.length).toBe(1)
    expect(worklets[0]!.code).toMatch(/runOnBackground\(_jsFn1\)\(1, 'x'\)/)
    expect(worklets[0]!.code).toMatch(/let\s*\{\s*_jsFn1\s*\}\s*=\s*this\["_jsFn"\]/)
    expect(code).toMatch(/transformToWorklet\(closeRef\)/)
  })

  it('leaves runOnMainThread(fn) calls for SWC, registering the worklet', () => {
    const src = `
import { runOnMainThread } from '@lynx-solid/runtime'
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
export function App() {
  const pos = 10
  const apply = (x) => {
    'main thread'
    return pos + x
  }
  const animate = runOnMainThread(apply)
  return animate
}
`
    const { code, worklets } = compileDomModule(src)
    expect(worklets.length).toBe(1)
    // the call is untouched; SWC shaped `apply` into `{ _c, _wkltId }`
    expect(code).toMatch(/runOnMainThread\(apply\)/)
    expect(worklets[0]!.id).toMatch(/^[0-9a-f]+:[0-9a-f]+:\d+$/)
    expect(worklets[0]!.code).toMatch(/let\s*\{\s*pos\s*\}\s*=\s*this\["_c"\]/)
  })

  it('assigns distinct template ids across many templates (collision guard)', () => {
    // Mirrors vue-lynx mergeElementTemplate collision-throw: ids must be
    // unique or INSTANTIATE would mount the wrong skeleton.
    const parts: string[] = []
    for (let i = 0; i < 120; i++) {
      parts.push(`function C${i}() { return <view class="c${i}"><text>t${i}</text></view> }`)
    }
    const src = `${parts.join('\n')}\nrenderer.render(() => <App />, createPageRoot())`
    const { templates } = compileDomModule(src)
    expect(templates.length).toBeGreaterThan(100)
    expect(new Set(templates.map(t => t.id)).size).toBe(templates.length)
  })

  it('scope adapter seam: unscoped output emits no scope statements, custom adapters plug in', async () => {
    const { buildCreateCode } = await import('../../packages/compiler/babel-plugin-jsx-lynx/src/dom/create-code')
    const { noScopeAdapter } = await import('../../packages/compiler/babel-plugin-jsx-lynx/src/dom/scope-adapter')
    const node = {
      kind: 'element',
      tag: 'view',
      children: [{ kind: 'text', text: 'hi', children: [] }],
    }
    expect(noScopeAdapter.elementScopeStatements('e0', null)).toEqual([])
    const plain = buildCreateCode(node as never)
    expect(plain.code).not.toContain('__SetCSSId')
    const scoped = buildCreateCode(node as never, [], {
      elementScopeStatements: (v: string) => [`__SetCSSId([${v}], 7);`],
    })
    expect(scoped.code).toContain('__SetCSSId([e0], 7);')
    expect(scoped.code).toContain('__SetCSSId([e1], 7);')
    expect(scoped.nodeCount).toBe(plain.nodeCount)
  })

  it('anchors trailing multi slots with BG-only markers (no MT placeholder views)', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { Show, createSignal } from 'solid-js'
const [a, setA] = createSignal(true)
const [b, setB] = createSignal(true)
function App() {
  return (
    <view>
      <text>head</text>
      <Show when={a()}><text>A</text></Show>
      <Show when={b()}><text>B</text></Show>
    </view>
  )
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    // parent skeleton: root view + head text only (folded text attr) — both
    // trailing Show slots keep `dyn` entries (nothing emitted)
    const parent = templates.find(t => t.createCode.includes('P.create("view")'))!
    expect(parent.createCode).toContain('P.prop(e1,"text","head")')
    expect(parent.createCode.match(/P\.create\("view"\)/g)).toHaveLength(1)
    // view + head text element (glyphs live on the text attribute now)
    expect(parent.nodeCount).toBe(2)
    // the only refs entry is the static head text (markers take no refs slot)
    expect(parent.anchors).toEqual([{ index: 0, offset: 1 }])
    // both slots anchor on BG-only markers, allocated in document order
    expect(code).toMatch(/marker as _\$marker/)
    expect(code).toMatch(/_\$insert\(_el\$, _el\$, _\$createComponent\(Show,[\s\S]*?_\$marker\(_el\$, _el\$, 0\)\)/)
    expect(code).toMatch(/_\$insert\(_el\$, _el\$, _\$createComponent\(Show,[\s\S]*?_\$marker\(_el\$, _el\$, 1\)\)/)
  })

  it('<list> accepts For rows with list-item children', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
import { For, createSignal } from 'solid-js'
const [items, setItems] = createSignal([{ id: 1, label: 'a' }])
function App() {
  return (
    <list>
      <For each={items()}>{(item) => <list-item item-key={item.id}><text>{item.label}</text></list-item>}</For>
    </list>
  )
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    // the list template carries no static children: rows live in the split
    // item template, so nothing but the list element itself joins its id run
    const root = templates.find(t => t.createCode.includes('P.create("list")'))!
    expect(root.nodeCount).toBe(1)
    expect(root.createCode).not.toContain('P.create("view")')
    expect(root.createCode).not.toContain('P.create("text")')
    const item = templates.find(t => t.createCode.includes('P.create("list-item")'))!
    expect(item.anchors).toEqual([{ index: 0, offset: 1 }])
    expect(code).toContain('createComponent(For,')
  })

  it('rewrites <page> to the Page component (no native page CREATE)', () => {
    const src = `
import { createPageRoot, renderer } from '../../packages/runtime/src/background/renderer'
function App() {
  return (
    <page class="bg-hn">
      <view><text>hi</text></view>
    </page>
  )
}
renderer.render(() => <App />, createPageRoot())
`
    const { code, templates } = compileDomModule(src)
    expect(code).toContain('createComponent(')
    // Page is a builtIn — imported from lynx-template, not a raw createElement('page')
    expect(code).toMatch(/Page/)
    expect(code).not.toMatch(/P\.create\("page"\)/)
    expect(code).not.toContain('createElement("page"')
    // children still compile to a view template
    expect(templates.some(t => t.createCode.includes('P.create("view")'))).toBe(true)
    expect(templates.every(t => !t.createCode.includes('P.create("page")'))).toBe(true)
  })

  it('rejects <page> nested inside a native element', () => {
    const src = `
function App() {
  return (
    <view>
      <page class="x"><text>no</text></page>
    </view>
  )
}
`
    expect(() => compileDomModule(src)).toThrow(/outermost element/)
  })
})
