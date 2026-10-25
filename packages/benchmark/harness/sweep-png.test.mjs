/**
 * Offline unit check for sweep-png: synthetic PNGs with known content
 * scores + a real device screencap when present.
 *
 *   node harness/sweep-png.test.mjs
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

import { CONTENT_SCORE_MIN, contentScore, decodePng } from './sweep-png.mjs'

const harnessDir = path.dirname(fileURLToPath(import.meta.url))
const resultsDir = path.join(harnessDir, '../results')

// --- minimal PNG writer (8-bit RGB, filter 0) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++)
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const b of buf)
    c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function makePng(w, h, pixelAt) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // RGB
  const raw = Buffer.alloc(h * (1 + w * 3))
  let p = 0
  for (let y = 0; y < h; y++) {
    raw[p++] = 0 // filter none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixelAt(x, y)
      raw[p++] = r
      raw[p++] = g
      raw[p++] = b
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${detail}`}`)
  if (!ok)
    failed++
}

// 1) uniform white screen -> score ~0 (empty/loading)
const white = decodePng(makePng(64, 64, () => [255, 255, 255]))
check('decode-dims', white.width === 64 && white.height === 64 && white.channels === 3, JSON.stringify(white))
const sWhite = contentScore(white)
check('white-scores-low', sWhite < CONTENT_SCORE_MIN, sWhite)

// 2) mid band mostly black content -> high score
const black = decodePng(makePng(64, 64, (x, y) => (y > 19 && y < 45 && x > 8 && x < 56 ? [0, 0, 0] : [255, 255, 255])))
const sBlack = contentScore(black)
check('content-scores-high', sBlack >= CONTENT_SCORE_MIN, sBlack)

// 3) mild off-white UI-ish tint stays low (median robustness)
const tint = decodePng(makePng(64, 64, (x, y) => (y > 19 && y < 45 && x > 30 ? [245, 245, 250] : [250, 250, 250])))
const sTint = contentScore(tint)
check('tint-stays-low', sTint < CONTENT_SCORE_MIN, sTint)

// 4) real device screencap (if the living record exists)
const realPath = path.join(resultsDir, 'device-selftest-latest.png')
if (fs.existsSync(realPath)) {
  try {
    const img = decodePng(fs.readFileSync(realPath))
    const s = contentScore(img)
    console.log(`[real] ${img.width}x${img.height} ch=${img.channels} score=${s.toFixed(4)}`)
    check('real-decodes', img.width > 100 && Number.isFinite(s), `w=${img.width}`)
    // device-probe.png is the rendered counter screen — must clear the min
    if (path.basename(realPath) === 'device-probe.png')
      check('real-counter-has-content', s >= CONTENT_SCORE_MIN, s)
  }
  catch (e) {
    check('real-decodes', false, String(e))
  }
}
else {
  console.log('[real] device-selftest-latest.png absent — skipped')
}

process.exit(failed > 0 ? 1 : 0)
