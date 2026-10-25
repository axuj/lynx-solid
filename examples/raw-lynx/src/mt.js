/* eslint-disable no-var, vars-on-top, no-undef, antfu/if-newline, style/max-statements-per-line */
/* Raw PAPI demo — zero framework, dual-thread style bridge.
 * MT renderPage builds an empty page. BG (bg.js) sends SET_STYLE ops
 * (opcode 8) via callLepusMethod('rawPatchUpdate'); MT applies them
 * with __SetInlineStyles in one batch + trailing flush.
 *
 * Text creation splits by role, matching how the Lynx engine distinguishes
 * text runs from addressable text elements:
 *   - text runs (labels, mixed/dynamic content) → __CreateRawText
 *   - real <text> elements (style targets)     → __CreateText */

var registry = {}
var pageEl = null
var pageUniqueId = 0
var built = false

function label(text) {
  // text run — raw node, inherits parent font-*
  return __CreateRawText(text)
}

function section(parent, title, hint) {
  var wrap = __CreateView(pageUniqueId)
  __SetAttribute(wrap, 'style', 'margin-top:24px;background:#333;border-radius:6px;padding:8px')
  var h = label(title)
  __SetAttribute(h, 'style', 'color:#fff;font-size:18px;font-weight:bold')
  __AppendElement(wrap, h)
  var p = label(hint)
  __SetAttribute(p, 'style', 'color:#aaa;font-size:13px')
  __AppendElement(wrap, p)
  __AppendElement(parent, wrap)
  return wrap
}

function row(parent, id, name, content, expected) {
  var wrap = __CreateView(pageUniqueId)
  __SetAttribute(wrap, 'style', 'margin-top:6px;padding:8px;background:#f0f0f0;border-radius:4px')

  var head = label(name)
  __SetAttribute(head, 'style', 'font-size:15px;font-weight:bold;color:#333')
  __AppendElement(wrap, head)

  // real text element — glyphs sit ON the SET_STYLE target
  var t = __CreateText(pageUniqueId)
  __SetCSSId([t], 0)
  __SetAttribute(t, 'text', content)
  __SetAttribute(t, 'style', 'font-size:28px')
  if (id) registry[id] = t
  __AppendElement(wrap, t)

  var exp = label(expected)
  __SetAttribute(exp, 'style', 'color:#888;font-size:13px;margin-top:2px')
  __AppendElement(wrap, exp)

  __AppendElement(parent, wrap)
  return t
}

function buildTree() {
  var root = __CreateView(pageUniqueId)
  __AppendElement(pageEl, root)

  // ── 1: BG → MT SET_STYLE bridge ──
  var s1 = section(
    root,
    '1 · SET_STYLE bridge (BG → MT)',
    'ops via callLepusMethod · if nothing styles, bridge never fired',
  )
  row(s1, 1, 'R0 color', 'red?', 'expect: #cc0000')
  row(s1, 2, 'R1 fontStyle', 'italic?', 'expect: italic')
  row(s1, 3, 'R2 fontSize', 'big?', 'expect: 60px')
  row(s1, 4, 'R3 fontWeight', 'bold?', 'expect: bold')
  row(s1, 5, 'R4 kebab string', 'string form?', 'expect: italic 30 red')
  row(s1, 6, 'R5 full object', 'object form?', 'expect: italic 30 red')
  // id 7: styled directly on MT (control — no bridge involved)
  row(s1, 7, 'R6 MT-direct control', 'always styled?', 'expect: italic 30 red (no bridge)')

  // ── 2: child run — raw inherits, nested __CreateText dies ──
  var s2 = section(
    root,
    '2 · Child text run inheritance',
    'style on parent text · left dies, right inherits',
  )

  // A: anti-pattern — child as __CreateText (engine limit: only color/font-family inherit)
  var badWrap = __CreateView(pageUniqueId)
  __SetAttribute(badWrap, 'style', 'margin-top:6px;padding:8px;background:#f0f0f0;border-radius:4px')
  var badHead = label('NEST-A child __CreateText (old)')
  __SetAttribute(badHead, 'style', 'font-size:15px;font-weight:bold;color:#333')
  __AppendElement(badWrap, badHead)
  var badParent = __CreateText(pageUniqueId)
  __SetCSSId([badParent], 0)
  registry[8] = badParent
  var badChild = __CreateText(pageUniqueId)
  __SetAttribute(badChild, 'text', 'nested __CreateText?')
  __AppendElement(badParent, badChild)
  __AppendElement(badWrap, badParent)
  var badExp = label('expect: green inherits · italic/40px DIE')
  __SetAttribute(badExp, 'style', 'color:#888;font-size:13px;margin-top:2px')
  __AppendElement(badWrap, badExp)
  __AppendElement(s2, badWrap)

  // B: correct — child as __CreateRawText run (full font-* inherit)
  var okWrap = __CreateView(pageUniqueId)
  __SetAttribute(okWrap, 'style', 'margin-top:6px;padding:8px;background:#ddffdd;border-radius:4px')
  var okHead = label('NEST-B child __CreateRawText')
  __SetAttribute(okHead, 'style', 'font-size:15px;font-weight:bold;color:#333')
  __AppendElement(okWrap, okHead)
  var okParent = __CreateText(pageUniqueId)
  __SetCSSId([okParent], 0)
  registry[9] = okParent
  var okChild = __CreateRawText('raw-text run child?')
  __AppendElement(okParent, okChild)
  __AppendElement(okWrap, okParent)
  var okExp = label('expect: green + italic + 40px ALL inherit')
  __SetAttribute(okExp, 'style', 'color:#888;font-size:13px;margin-top:2px')
  __AppendElement(okWrap, okExp)
  __AppendElement(s2, okWrap)
}

globalThis.rawPatchUpdate = function (params) {
  if (!built) {
    buildTree()
    built = true
    globalThis.__rawBuilt = true
  }
  // R6 control: direct per-key apply — always works, independent of bridge
  var r6 = registry[7]
  if (r6) {
    __AddInlineStyle(r6, 'font-style', 'italic')
    __AddInlineStyle(r6, 'font-size', '30px')
    __AddInlineStyle(r6, 'color', '#cc0000')
  }
  // bridge styles — id 8 = NEST-A parent, id 9 = NEST-B parent
  var ops = JSON.parse(params.data)
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i]
    if (op[0] === 8) {
      var el = registry[op[1]]
      if (el) __SetInlineStyles(el, op[2])
    }
  }
  __FlushElementTree(pageEl)
}

globalThis.renderPage = function () {
  var page = __CreatePage('0', 0)
  pageEl = page
  globalThis.__rawPage = page
  __SetCSSId([page], 0)
  pageUniqueId = __GetElementUniqueID(page)
  var boot = label('RAW PAPI demo — waiting for BG ops…')
  __SetAttribute(boot, 'style', 'color:#999;font-size:14px;padding:16px')
  __AppendElement(page, boot)
  __FlushElementTree(page)
}

globalThis.updatePage = function () {}
globalThis.processData = function (d) { return d || {} }
