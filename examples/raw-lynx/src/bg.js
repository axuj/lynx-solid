/* eslint-disable no-var, vars-on-top, no-undef, prefer-arrow-callback, antfu/if-newline, style/max-statements-per-line, style/brace-style, unused-imports/no-unused-vars */
/* BG side: builds SET_STYLE ops (opcode 8) and ships them to MT via
 * callLepusMethod('rawPatchUpdate'). MT applies + flushes. Styles ONLY
 * arrive through this path (except R6, styled directly on MT).
 * sendOps is idempotent full-replace; retries cover renderPage timing. */
globalThis.updatePage = function () {}
globalThis.processData = function (d) { return d || {} }

var SET_STYLE = 8
// ids 1..7 = R0..R6, 8 = NEST-A parent, 9 = NEST-B parent — match mt.js registry
var ops = [
  [SET_STYLE, 1, { color: '#cc0000' }],
  [SET_STYLE, 2, { fontStyle: 'italic' }],
  [SET_STYLE, 3, { fontSize: '60px' }],
  [SET_STYLE, 4, { fontWeight: 'bold' }],
  [SET_STYLE, 5, 'font-size:30px;font-style:italic;color:#cc0000'],
  [SET_STYLE, 6, { fontSize: '30px', fontStyle: 'italic', color: '#cc0000' }],
  [SET_STYLE, 7, { fontStyle: 'italic', fontSize: '30px', color: '#cc0000' }],
  // NEST-A / NEST-B parent: style on parent, glyphs on child run
  [SET_STYLE, 8, { fontStyle: 'italic', fontSize: '40px', color: '#00aa00' }],
  [SET_STYLE, 9, { fontStyle: 'italic', fontSize: '40px', color: '#00aa00' }],
]

function sendOps() {
  try {
    if (typeof lynx === 'undefined' || !lynx || typeof lynx.getNativeApp !== 'function')
      return
    var app = lynx.getNativeApp()
    if (!app || typeof app.callLepusMethod !== 'function') return
    app.callLepusMethod('rawPatchUpdate', { data: JSON.stringify(ops) }, function () {})
  } catch (e) {}
}

// MT renderPage timing vs BG eval is engine-ordered; send twice —
// idempotent full-replace, so at least one batch lands after mount.
setTimeout(sendOps, 500)
setTimeout(sendOps, 2000)
setTimeout(sendOps, 5000)
