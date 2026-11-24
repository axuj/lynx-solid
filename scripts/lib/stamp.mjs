#!/usr/bin/env node
// Input signatures, lifted from `website/scripts/prepare-examples.mjs`.
//
// Comparing an output's mtime against its sources' mtime does not converge: a
// bundler is free to leave an unchanged output alone, and checked-out files can
// carry mtimes a build never overtakes. Recording the input signature at build
// time is stable across both, and a JSON stamp makes "why did it rebuild?"
// answerable after the fact.
//
// The signature is the newest mtime under a directory, which errs towards
// rebuilding: switching branches bumps mtimes and costs one extra build, while a
// missed rebuild would hand you a stale artifact that looks fresh.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function statSafe(file) {
  try {
    return statSync(file)
  }
  catch {
    return undefined
  }
}

export function fileMtime(file) {
  return statSafe(file)?.mtimeMs ?? 0
}

export function maxMtime(dir, skipDirs = new Set(), skipFile = () => false) {
  const stat = statSafe(dir)
  if (!stat)
    return 0
  if (!stat.isDirectory())
    return stat.mtimeMs

  let max = 0
  let names
  try {
    names = readdirSync(dir)
  }
  catch {
    return 0
  }

  for (const name of names) {
    if (skipDirs.has(name) || skipFile(name))
      continue
    const full = path.join(dir, name)
    const entry = statSafe(full)
    if (!entry)
      continue
    max = Math.max(max, entry.isDirectory() ? maxMtime(full, skipDirs, skipFile) : entry.mtimeMs)
  }
  return max
}

export function readStamps(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  catch {
    return {}
  }
}

export function saveStamps(file, stamps) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(stamps, null, 2)}\n`)
}
