#!/usr/bin/env node
// Device checks for the Android verifier, written as assertions rather than
// things to eyeball.
//
// The failure this exists for: `adb exec-out screencap` on a sleeping phone
// returns a flat white frame, so a screenshot taken at the wrong moment looks
// exactly like an app that rendered nothing. Every capture here first proves
// the display is on and unlocked, then proves the frame is not a single colour.

import { execFileSync } from 'node:child_process'
import { fail } from './release-state.mjs'

function adb(serial, args, options = {}) {
  // A raw screencap is width*height*4 bytes (~9 MB at 1080x2160); the default
  // 1 MB buffer fails with ENOBUFS.
  return execFileSync('adb', ['-s', serial, ...args], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, ...options })
}

export function requireDevice() {
  const listing = execFileSync('adb', ['devices'], { encoding: 'utf8' })
  const devices = listing
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/)
      return { serial, state }
    })
    .filter(entry => entry.state === 'device')

  if (devices.length === 0)
    fail(`no Android device is attached. Connect one over USB (or \`adb connect <ip>:5555\`) and retry.\n\n${listing.trim()}`)
  if (devices.length > 1)
    fail(`more than one Android device is attached (${devices.map(entry => entry.serial).join(', ')}). Set ANDROID_SERIAL to the one under test.`)
  return devices[0].serial
}

function power(serial) {
  return adb(serial, ['shell', 'dumpsys', 'power'], { encoding: 'utf8' })
}

export function displayIsOn(serial) {
  return /Display Power: state=ON/.test(power(serial))
}

function wakefulness(serial) {
  const match = power(serial).match(/mWakefulness=(\w+)/)
  return match?.[1] ?? 'unknown'
}

function focusedWindow(serial) {
  const out = adb(serial, ['shell', 'dumpsys', 'window'], { encoding: 'utf8' })
  return out.match(/mCurrentFocus=(\S+)/)?.[1] ?? ''
}

/**
 * Wake the phone and dismiss a swipe-only keyguard. A PIN cannot be typed from
 * here, so that case fails with an instruction instead of producing a blank
 * frame later.
 */
export function ensureUnlocked(serial) {
  if (wakefulness(serial) !== 'Awake') {
    adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], { encoding: 'utf8' })
    sleep(1000)
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const focus = focusedWindow(serial)
    if (!/StatusBar|NotificationShade|Keyguard/.test(focus))
      return
    adb(serial, ['shell', 'input', 'swipe', '540', '1600', '540', '500', '300'], { encoding: 'utf8' })
    sleep(1500)
  }
  fail(`the device is locked (focus: ${focusedWindow(serial)}). Unlock it and run again; a PIN cannot be entered from here.`)
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Keep the display awake for the duration of a check. Without this the screen
 * sleeps during a multi-minute build and every later capture is a blank frame.
 */
export function keepScreenOn(serial, on) {
  adb(serial, ['shell', 'svc', 'power', 'stayon', on ? 'usb' : 'false'], { encoding: 'utf8' })
}

/**
 * A raw screencap: 12-byte header (width, height, format) followed by RGBA.
 *
 * Returns the pixels rather than a summary because one class of assertion needs
 * them: finding a control by colour, then comparing the region it drives before
 * and after a tap. `summarizeFrame` is what the paint checks want.
 */
export function capturePixels(serial) {
  if (!displayIsOn(serial))
    fail('the display is off — a capture now would be a blank frame, not the app')
  const buffer = adb(serial, ['exec-out', 'screencap'])
  if (buffer.length < 16)
    fail(`screencap returned ${buffer.length} bytes`)

  const width = buffer.readUInt32LE(0)
  const height = buffer.readUInt32LE(4)
  return { width, height, data: buffer.subarray(buffer.length - width * height * 4) }
}

/** The numbers an assertion can use, sampled from a captured frame. */
export function summarizeFrame(frame) {
  const { width, height, data: pixels } = frame
  const seen = new Set()
  let sum = 0
  let sumSquares = 0
  let samples = 0
  const stride = 4 * 37 // prime, so the sample grid does not line up with the layout
  for (let offset = 0; offset + 4 <= pixels.length; offset += stride) {
    const r = pixels[offset]
    const g = pixels[offset + 1]
    const b = pixels[offset + 2]
    const luminance = (r * 299 + g * 587 + b * 114) / 1000
    sum += luminance
    sumSquares += luminance * luminance
    samples++
    if (seen.size < 64)
      seen.add((r << 16) | (g << 8) | b)
  }
  const mean = sum / samples
  const deviation = Math.sqrt(Math.max(0, sumSquares / samples - mean * mean))
  return { width, height, samples, mean, deviation, distinctColors: seen.size }
}

export function assertFrameIsPainted(frame, what) {
  if (frame.deviation < 2 || frame.distinctColors < 3) {
    fail(`${what} is a flat ${frame.width}x${frame.height} frame (mean ${frame.mean.toFixed(1)}, deviation ${frame.deviation.toFixed(2)}, ${frame.distinctColors} colours). `
      + 'The app did not paint, or the capture did not come from the display.')
  }
}

// The accent colour a page uses for filled buttons (#22d3ee in this app's
// Tailwind tokens) is the only thing in a frame that is both saturated and dark
// in red. Neutral chrome is either too dark or too red, and accent-coloured
// *text* never covers a whole row.
function isAccent(r, g, b) {
  return b >= 180 && g >= 150 && r <= 140
}

/**
 * Solid accent-coloured blocks, as rectangles, top to bottom.
 *
 * A row belongs to a block when 30% of its pixels carry the accent colour — a
 * filled button does, a label rendered in the same colour never does — and
 * contiguous rows are merged. Coordinates come from the frame being asserted
 * on, so they move with the layout instead of pinning one screen size.
 */
export function findAccentBlocks(frame) {
  const { width, height, data } = frame
  const solid = []
  for (let y = 0; y < height; y++) {
    let count = 0
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (isAccent(data[offset], data[offset + 1], data[offset + 2]))
        count++
    }
    solid.push(count >= width * 0.3)
  }

  const blocks = []
  let start = -1
  for (let y = 0; y <= height; y++) {
    if (y < height && solid[y]) {
      if (start < 0)
        start = y
      continue
    }
    if (start >= 0) {
      const block = measureBlock(frame, start, y - 1)
      if (block)
        blocks.push(block)
      start = -1
    }
  }
  return blocks
}

function measureBlock(frame, top, bottom) {
  const { width, data } = frame
  let left = width
  let right = -1
  let sumX = 0
  let count = 0
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (!isAccent(data[offset], data[offset + 1], data[offset + 2]))
        continue
      if (x < left)
        left = x
      if (x > right)
        right = x
      sumX += x
      count++
    }
  }
  if (count === 0)
    return undefined
  return { top, bottom, left, right, cx: Math.round(sumX / count), cy: Math.round((top + bottom) / 2) }
}

/**
 * Tap a point in device pixels — the same grid `capturePixels` returns, so a
 * coordinate measured from a frame can be used here without scaling.
 */
export function tap(serial, x, y) {
  adb(serial, ['shell', 'input', 'tap', String(x), String(y)], { encoding: 'utf8' })
}

function regionBounds(frame, region) {
  const x = Math.max(0, Math.min(region.x, frame.width - 1))
  const y = Math.max(0, Math.min(region.y, frame.height - 1))
  const right = Math.min(frame.width, region.x + region.width)
  const bottom = Math.min(frame.height, region.y + region.height)
  if (right <= x || bottom <= y)
    fail(`region ${JSON.stringify(region)} falls outside the ${frame.width}x${frame.height} frame`)
  return { x, y, width: right - x, height: bottom - y }
}

/** Bright pixels in a region — text ink, as opposed to background. */
export function countInk(frame, region) {
  const { x, y, width, height } = regionBounds(frame, region)
  const { width: frameWidth, data } = frame
  let ink = 0
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) {
      const offset = (row * frameWidth + col) * 4
      if (data[offset] > 180 && data[offset + 1] > 180 && data[offset + 2] > 180)
        ink++
    }
  }
  return ink
}

/** How many pixels of a region differ between two frames of the same size. */
export function diffRegion(before, after, region) {
  if (before.width !== after.width || before.height !== after.height)
    fail(`cannot compare a ${before.width}x${before.height} frame with a ${after.width}x${after.height} one`)
  const { x, y, width, height } = regionBounds(before, region)
  let changed = 0
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) {
      const offset = (row * before.width + col) * 4
      if (before.data[offset] !== after.data[offset]
        || before.data[offset + 1] !== after.data[offset + 1]
        || before.data[offset + 2] !== after.data[offset + 2]) {
        changed++
      }
    }
  }
  return { changed, total: width * height }
}

export function foregroundActivity(serial) {
  const out = adb(serial, ['shell', 'dumpsys', 'activity', 'activities'], { encoding: 'utf8' })
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes('ResumedActivity'))
      continue
    const match = line.match(/([\w.]+)\/([\w.$]+)/)
    if (match)
      return `${match[1]}/${match[2]}`
  }
  return ''
}

export function launchActivity(serial, component) {
  adb(serial, ['shell', 'am', 'start', '-n', component], { encoding: 'utf8' })
}

export function launcherActivity(serial, pkg) {
  const out = adb(serial, ['shell', 'cmd', 'package', 'resolve-activity', '--brief', pkg], { encoding: 'utf8' })
  const component = out.split(/\r?\n/).map(line => line.trim()).filter(line => line.includes('/')).pop()
  if (!component)
    fail(`could not resolve a launcher activity for ${pkg} — is it installed?\n${out}`)
  return component
}

export function processId(serial, pkg) {
  try {
    const out = adb(serial, ['shell', 'pidof', pkg], { encoding: 'utf8' }).trim()
    return out || undefined
  }
  catch {
    return undefined
  }
}

/** Crash lines for one pid since the app was launched. */
export function crashes(serial, pid) {
  const out = adb(serial, ['logcat', '-d', `--pid=${pid}`], { encoding: 'utf8' })
  return out.split(/\r?\n/).filter(line => /FATAL EXCEPTION|AndroidRuntime: Shutting down VM/.test(line))
}

export { sleep }
