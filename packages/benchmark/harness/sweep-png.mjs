/**
 * Minimal PNG decode + content scoring for the device sweep's screencap
 * channel. Handles screencap's format: 8-bit gray/RGB/RGBA, non-interlaced.
 */
import { Buffer } from 'node:buffer'
import { inflateSync } from 'node:zlib'

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47)
    throw new Error('not a PNG')
  let off = 8
  let w = 0
  let h = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    }
    else if (type === 'IDAT') {
      idat.push(data)
    }
    else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 6].includes(colorType))
    throw new Error(`unsupported PNG (depth=${bitDepth} color=${colorType} interlace=${interlace})`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * channels
  const out = Buffer.alloc(h * stride)
  let rp = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++]
    const row = y * stride
    const prev = row - stride
    for (let x = 0; x < stride; x++) {
      const v = raw[rp++]
      const a = x >= channels ? out[row + x - channels] : 0
      const b = y > 0 ? out[prev + x] : 0
      const c = y > 0 && x >= channels ? out[prev + x - channels] : 0
      let val
      switch (filter) {
        case 0:
          val = v
          break
        case 1:
          val = v + a
          break
        case 2:
          val = v + b
          break
        case 3:
          val = v + ((a + b) >> 1)
          break
        default: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        }
      }
      out[row + x] = val & 0xFF
    }
  }
  return { width: w, height: h, channels, data: out }
}

/**
 * Content score in [0,1]: share of sampled mid-screen pixels far from the
 * band's dominant (median) color. Band = 8%–92% height (excludes status bar,
 * explorer back arrow and gesture bar). Empty/loading screens score ~0;
 * even sparse content (a text line + one button) clears CONTENT_SCORE_MIN.
 */
export function contentScore(img) {
  const { width: w, height: h, channels: ch, data } = img
  const y0 = Math.floor(h * 0.08)
  const y1 = Math.floor(h * 0.92)
  const step = Math.max(1, Math.floor(w / 120))
  const samples = []
  for (let y = y0; y < y1; y += 6) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * ch
      samples.push((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
    }
  }
  if (samples.length === 0)
    return 0
  const rs = samples.map(v => v >> 16).sort((a, b) => a - b)
  const gs = samples.map(v => (v >> 8) & 0xFF).sort((a, b) => a - b)
  const bs = samples.map(v => v & 0xFF).sort((a, b) => a - b)
  const mid = arr => arr[arr.length >> 1]
  const dr = mid(rs)
  const dg = mid(gs)
  const db = mid(bs)
  let far = 0
  for (const v of samples) {
    const r = (v >> 16) - dr
    const g = ((v >> 8) & 0xFF) - dg
    const b = (v & 0xFF) - db
    if (r * r + g * g + b * b > 900) // ≈ per-channel distance > ~17
      far++
  }
  return far / samples.length
}

export const CONTENT_SCORE_MIN = 0.003
