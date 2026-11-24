#!/usr/bin/env node
// Does the next release actually work? This drives the desktop demo against it.
//
// The state under test comes from `switchToReleaseState` (packages packed as
// publish would send them + the repository's companion versions), because the
// app's own lockfile only describes the last release. Mixing the two fails
// to link: the runtime on HEAD wants solid-js rc.22 while the published 0.1.1
// pins rc.18.
//
// Everything asserted here is text from agent-lynx's snapshot. Refs (`@e10`)
// are positional and move with the layout, so nothing is allowed to remember
// one. Preconditions are checked explicitly — a window that never rendered and
// a client belonging to another app both look like "no elements" otherwise.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { clients, findText, tapText, trySnapshot } from '../../../scripts/lib/agent-lynx.mjs'
import { assertInstalled, fail, readJson, restoreLockfile, run, step, switchToReleaseState, VerificationError } from '../../../scripts/lib/release-state.mjs'

const root = path.resolve(import.meta.dirname, '../../..')
const appDir = path.resolve(import.meta.dirname, '..')

let app
let appLog = []

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function waitFor(description, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let last = []
  while (Date.now() < deadline) {
    // The client registers before the page has a session, so the first few
    // polls legitimately see nothing — that is what the timeout is for.
    last = trySnapshot(appDir) ?? last
    const found = predicate(last)
    if (found)
      return found
    sleep(250)
  }
  const visible = last.map(ref => ref.text).filter(Boolean).join('\n')
  fail(`timed out after ${timeoutMs}ms waiting for ${description}. Screen showed:\n${visible || '(nothing)'}\n\napp output:\n${appLog.join('\n') || '(nothing)'}`)
}

function remember(chunk) {
  appLog.push(...String(chunk).split(/\r?\n/).filter(Boolean))
  appLog = appLog.slice(-40)
}

function stopApp() {
  if (!app || app.exitCode !== null)
    return
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  else
    app.kill('SIGTERM')
  // The DevTool session on :8901 outlives the window for a moment; the next run
  // would find it and drive a dead page.
  for (let i = 0; i < 40; i++) {
    try {
      if (clients(appDir).length === 0)
        return
    }
    catch {}
    sleep(250)
  }
  console.warn('warning: a Lynxtron client is still registered after the window was closed')
}

function cleanup() {
  try {
    stopApp()
    restoreLockfile(root, appDir)
  }
  catch (error) {
    console.error(`cleanup failed: ${error.message}`)
  }
}

async function main() {
  if (!existsSync(appDir))
    fail('apps/lynxtron is missing')

  const expectedApp = readJson(path.join(appDir, 'package.json')).name

  // A window from an earlier run answers on :8901 and would be inspected
  // instead of the one this run builds.
  const before = clients(appDir)
  if (before.length > 0)
    fail(`a Lynx client is already connected (${before.map(client => client.id).join(', ')}) — close that window first, it would be inspected instead of the one this run builds`)

  const { companions } = switchToReleaseState(root, appDir, { force: process.argv.includes('--force') })
  assertInstalled(appDir, companions)

  step('building the app against the release state')
  run('nub', ['run', 'build'], appDir)

  step('launching the window')
  const cli = path.join(appDir, 'node_modules', '@lynx-js', 'lynxtron', 'cli.js')
  if (!existsSync(cli))
    fail(`${cli} is missing — did the install change?`)
  app = spawn(process.execPath, [cli, 'dist/desktop'], {
    cwd: appDir,
    // Package-manager shims inject `--require <preload>` here; the runtime is
    // an Electron fork and would never reach main.js.
    env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  app.stdout.on('data', remember)
  app.stderr.on('data', remember)

  const deadline = Date.now() + 60_000
  let client
  while (!client) {
    if (app.exitCode !== null)
      fail(`the window exited with ${app.exitCode} before it was inspectable:\n${appLog.join('\n')}`)
    if (Date.now() > deadline)
      fail(`the window never became inspectable:\n${appLog.join('\n')}`)
    client = clients(appDir).find(candidate => candidate.id.startsWith('desktop:'))
    if (!client)
      sleep(500)
  }
  // A phone running Lynx Explorer can be connected at the same time; driving it
  // would test the wrong app.
  if (client.info?.App !== expectedApp)
    fail(`the desktop client reports App=${client.info?.App}, expected ${expectedApp}`)
  console.log(`  ${client.id} (${client.info.App})`)

  step('checking the UI')
  // The DevTool session appears before the bundle has rendered.
  const first = waitFor('the demo to render', refs => (findText(refs, 'Lynx Solid × Lynxtron') ? refs : undefined), 30_000)
  if (!findText(first, 'nothing yet'))
    fail('the round trip starts out already answered')
  if (!first.some(ref => ref.text === '0'))
    fail('the counter does not start at 0')
  console.log('  counter starts at 0')

  tapText(appDir, '+')
  waitFor('the counter to reach 1', refs => refs.some(ref => ref.text === '1'))
  console.log('  counter is 1')

  tapText(appDir, '+')
  waitFor('the counter to reach 2', refs => refs.some(ref => ref.text === '2'))
  console.log('  counter is 2')

  tapText(appDir, 'Ping main process')
  const pong = waitFor('the main process to answer', (refs) => {
    const text = refs.map(ref => ref.text).find(line => /^pid \d+ · /.test(line))
    return text?.includes(`${process.platform}/${process.arch}`) ? text : undefined
  })
  console.log(`  ${pong}`)

  tapText(appDir, 'Copy the counter value')
  const copied = waitFor('the clipboard to be read back', (refs) => {
    const text = refs.map(ref => ref.text).find(line => line.startsWith('read back from the clipboard:'))
    return text?.includes('count=2') ? text : undefined
  })
  console.log(`  ${copied}`)
}

main()
  .then(() => {
    console.log('\nok — the release state builds and the demo works')
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
