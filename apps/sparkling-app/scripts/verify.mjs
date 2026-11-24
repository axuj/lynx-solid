#!/usr/bin/env node
// Does the next release work inside the Sparkling app — not just as a bundle
// rendered by Lynx Explorer?
//
// The bundle is built from the release state (`switchToReleaseState`), copied
// into the Android assets, packaged and installed, and then driven from the
// outside over adb: the app must come to the foreground, paint something that
// is not a flat colour, and — because a demo nobody can tap proves little —
// react to a tap. The counter's digit changing is what that check rides on.
//
// No DevTool client is involved. The Sparkling shell does not register one
// (HybridKit's debug switches are on, but nothing listens on the debug port),
// so the button is located in the framebuffer instead: the accent-coloured
// block is the only wide, solid cyan region on the page, and the digit it
// drives sits directly above it. Both rectangles are measured from the frame
// under test, never written down, so another screen size moves them with the
// layout rather than breaking the check.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  assertFrameIsPainted,
  capturePixels,
  countInk,
  crashes,
  diffRegion,
  ensureUnlocked,
  findAccentBlocks,
  foregroundActivity,
  keepScreenOn,
  launchActivity,
  launcherActivity,
  processId,
  requireDevice,
  sleep,
  summarizeFrame,
  tap,
} from '../../../scripts/lib/android.mjs'
import { assertInstalled, fail, readJson, restoreLockfile, run, step, switchToReleaseState, VerificationError } from '../../../scripts/lib/release-state.mjs'

const root = path.resolve(import.meta.dirname, '../../..')
const appDir = path.resolve(import.meta.dirname, '..')

function packageName() {
  const config = readFileSync(path.join(appDir, 'app.config.ts'), 'utf8')
  const match = config.match(/packageName:\s*'([^']+)'/)
  if (!match)
    fail('could not read android.packageName from app.config.ts')
  return match[1]
}

// `nub run android` applies this itself; failing here beats a Gradle error
// twenty lines into a build.
function assertToolchain() {
  let output
  try {
    output = execFileSync('node', ['scripts/toolchain.mjs'], { cwd: appDir, encoding: 'utf8' })
  }
  catch (error) {
    fail(`the Android toolchain does not resolve:\n${error.stdout ?? ''}${error.stderr ?? ''}\n\nCopy .env.example to .env.local and set JAVA_HOME / ANDROID_HOME.`)
  }
  if (!/ANDROID_HOME=\S/.test(output))
    fail(`the Android toolchain does not resolve:\n${output}\n\nCopy .env.example to .env.local and set JAVA_HOME / ANDROID_HOME.`)
  console.log(output.trim().split(/\r?\n/).map(line => `  ${line}`).join('\n'))
}

function waitForForeground(serial, pkg, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let current = ''
  while (Date.now() < deadline) {
    current = foregroundActivity(serial)
    if (current.startsWith(`${pkg}/`))
      return current
    sleep(500)
  }
  fail(`the app never came to the foreground (last: ${current || 'unknown'})`)
}

/**
 * Where the counter's digit should be: right-aligned in the row above the
 * button, one button-height-and-a-half tall. Derived from the button rather
 * than written down, for the same reason the button itself is — the layout
 * decides, this only says which way to look from it.
 */
function counterRegion(block) {
  const width = block.right - block.left + 1
  const height = block.bottom - block.top + 1
  const regionWidth = Math.max(1, Math.round(width * 0.25))
  const regionHeight = Math.max(1, Math.round(height * 1.25))
  return {
    x: block.right - regionWidth + 1,
    y: block.top - Math.round(height * 1.5),
    width: regionWidth,
    height: regionHeight,
  }
}

/**
 * Poll until the region actually changes, instead of sleeping a guessed amount
 * and hoping the repaint landed. Returns the last frame either way; the caller
 * decides whether what it got is enough.
 */
function waitForRegionChange(serial, region, before, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  // Below this share the difference is a repaint of something else (an
  // anti-aliased edge, a clock), not one glyph replacing another.
  const meaningful = Math.max(Math.round(region.width * region.height * 0.002), 50)
  let after = before
  let diff = { changed: 0, total: region.width * region.height }
  while (Date.now() < deadline) {
    sleep(400)
    after = capturePixels(serial)
    diff = diffRegion(before, after, region)
    if (diff.changed >= meaningful)
      return { frame: after, diff, meaningful }
  }
  return { frame: after, diff, meaningful }
}

function cleanup() {
  restoreLockfile(root, appDir)
}

async function main() {
  if (!existsSync(appDir))
    fail('apps/sparkling-app is missing')

  const pkg = packageName()
  const serial = requireDevice()
  step(`using device ${serial}`)
  ensureUnlocked(serial)
  assertToolchain()

  const { version, companions } = switchToReleaseState(root, appDir, { force: process.argv.includes('--force') })
  assertInstalled(appDir, companions)

  step('building, installing and launching the app')
  run('nub', ['run', 'android'], appDir)

  // The install must carry the bundle that was just built, not a leftover.
  const assets = path.join(appDir, 'android/app/src/main/assets/main.lynx.bundle')
  if (!existsSync(assets))
    fail(`${assets} is missing — the build did not copy the bundle into the APK`)
  if (!readFileSync(assets, 'utf8').includes('A real app, not a demo page'))
    fail('the built bundle does not contain the demo copy — did the build pick another entry?')
  const installed = readJson(path.join(appDir, 'node_modules/@lynx-solid/runtime/package.json')).version
  if (installed !== version)
    fail(`@lynx-solid/runtime in the app is ${installed}, expected the packed ${version}`)

  step('checking what the app painted, and that it reacts')
  // The build takes minutes; the phone sleeps in the meantime, and a capture of
  // a sleeping display is a blank frame.
  ensureUnlocked(serial)
  keepScreenOn(serial, true)
  try {
    const component = launcherActivity(serial, pkg)
    // `nub run android` already launches it, but an app that was backgrounded
    // between the install and now would be checked as a thumbnail.
    launchActivity(serial, component)
    console.log(`  ${waitForForeground(serial, pkg, 60_000)}`)

    const pid = processId(serial, pkg)
    if (!pid)
      fail(`${pkg} is in the foreground but has no process`)

    // First frame, plus the bridge round trips the page does on mount.
    sleep(4000)
    const painted = foregroundActivity(serial)
    if (!painted.startsWith(`${pkg}/`))
      fail(`the app left the foreground before the check (${painted || 'unknown'})`)
    const frame = capturePixels(serial)
    const summary = summarizeFrame(frame)
    assertFrameIsPainted(summary, `${pkg} on ${serial}`)
    console.log(`  painted ${summary.width}x${summary.height}, ${summary.distinctColors}+ colours, deviation ${summary.deviation.toFixed(1)} in ${painted.split('/')[1]}`)

    // The counter is the first accent block on the page: the demo draws it
    // before the navigation card, and the digit it drives sits above it.
    const button = findAccentBlocks(frame)[0]
    if (!button)
      fail('the page painted, but no accent-coloured button was drawn — there is nothing here to tap')
    console.log(`  accent button y=${button.top}..${button.bottom} x=${button.left}..${button.right}, centre (${button.cx}, ${button.cy})`)

    const region = counterRegion(button)
    const inkBefore = countInk(frame, region)
    if (inkBefore === 0)
      fail(`nothing bright above the button (${region.width}x${region.height} at ${region.x},${region.y}) — the counter is not where this check looks for it`)

    tap(serial, button.cx, button.cy)
    const { frame: after, diff, meaningful } = waitForRegionChange(serial, region, frame, 10_000)
    if (diff.changed < meaningful)
      fail(`tapping (${button.cx}, ${button.cy}) changed ${diff.changed} of ${diff.total} pixels above the button — the tap did not land, or the page did not react`)
    const inkAfter = countInk(after, region)
    const share = ((diff.changed / diff.total) * 100).toFixed(1)
    console.log(`  tap landed: ${diff.changed}/${diff.total} px changed in the counter region (${share}%), ink ${inkBefore} → ${inkAfter}`)

    const afterTap = foregroundActivity(serial)
    if (!afterTap.startsWith(`${pkg}/`))
      fail(`the app left the foreground after the tap (${afterTap || 'unknown'})`)

    const crashLines = crashes(serial, pid)
    if (crashLines.length)
      fail(`the app crashed:\n${crashLines.join('\n')}`)
  }
  finally {
    keepScreenOn(serial, false)
  }

  step('what this run proved')
  console.log('  the release build starts, paints and reacts to a tap: the counter above the button changed under it')
  console.log('  not checked: the second page and its native navigation — that needs a second tap and an assertion on what it opened')
}

main()
  .then(() => {
    console.log('\nok — the release state builds, installs, paints and reacts to a tap in the app')
  })
  .catch((error) => {
    if (error instanceof VerificationError) {
      console.error(`\n${error.message}`)
      process.exitCode = 1
      return
    }
    console.error(error)
    process.exitCode = 1
  })
  .finally(cleanup)
