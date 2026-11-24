#!/usr/bin/env node
// agent-lynx, wrapped so a verifier can assert instead of read.
//
// Two habits matter here: "no clients" is an error to the CLI but an empty list
// to us, and the client you find may belong to another app (a phone running Lynx
// Explorer answers on the same port as the desktop window), so callers check
// identity before driving anything.

import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { fail } from './release-state.mjs'

// `npx.cmd` only runs through a shell on Windows; agent-lynx has no local
// install, and reusing npx keeps one copy of it in the npm cache. The command is
// built as one string because a shell plus an argv array is deprecated.
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function quote(part) {
  return /[ "']/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part
}

export function runAgent(cwd, args) {
  const command = [npx, '--yes', 'agent-lynx', ...args].map(quote).join(' ')
  return spawnSync(command, { cwd, encoding: 'utf8', shell: true })
}

export function agent(cwd, args) {
  const result = runAgent(cwd, args)
  if (result.status !== 0)
    fail(`agent-lynx ${args.join(' ')} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  return result.stdout
}

export function clients(cwd) {
  const result = runAgent(cwd, ['list-clients', '--json'])
  if (result.status !== 0) {
    if (`${result.stdout ?? ''}${result.stderr ?? ''}`.includes('No Lynx DevTool clients were found'))
      return []
    fail(`agent-lynx list-clients failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
  return JSON.parse(result.stdout)
}

export function snapshot(cwd) {
  const refs = trySnapshot(cwd)
  if (refs === null)
    fail('snapshot failed: the client is connected but has no session yet')
  return refs
}

/**
 * `snapshot` for a page that may not have registered its session yet: the
 * DevTool client shows up before the bundle has rendered, and asking too early
 * is a recoverable "target-not-found", not a failure. Returns `null` for that
 * case so a caller can poll; anything else that goes wrong still throws.
 */
export function trySnapshot(cwd) {
  const result = runAgent(cwd, ['snapshot', '--json'])
  let envelope
  try {
    envelope = JSON.parse(result.stdout)
  }
  catch {
    fail(`agent-lynx snapshot did not print JSON (exit ${result.status}):\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
  if (envelope.ok)
    return envelope.data.refs
  if (envelope.error?.recoverable)
    return null
  fail(`snapshot failed: ${JSON.stringify(envelope)}`)
}

/** Text is the only stable handle; refs are positional. */
export function findText(refs, text) {
  return refs.find(ref => ref.text === text) ?? refs.find(ref => ref.text.includes(text))
}

export function tapText(cwd, text) {
  const node = findText(snapshot(cwd), text)
  if (!node)
    fail(`"${text}" is not on screen — did the demo change its copy?`)
  agent(cwd, ['tap', node.parentRef ?? node.ref])
  console.log(`  tapped "${text}"`)
}
