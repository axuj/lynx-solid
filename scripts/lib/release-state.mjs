#!/usr/bin/env node
// The two apps under `apps/` install *published* `@lynx-solid/*`,
// so their lockfiles describe the last release, not this checkout. Verifying
// the next release means putting the app into the state that release would
// ship: the three packages packed exactly as `npm publish` would send them,
// plus the companion versions this repository is built against.
//
// Both verifiers go through here so "release state" means one thing. The switch
// uses `nub add --no-save`, which snapshots and restores package.json and
// nub.lock itself; `restoreLockfile` puts node_modules back on the lockfile.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileMtime, maxMtime, readStamps, saveStamps } from './stamp.mjs'

export class VerificationError extends Error {}

export function fail(message) {
  throw new VerificationError(message)
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

export function step(title) {
  console.log(`\n${title}`)
}

const PACKAGES = ['runtime', 'compiler', 'plugin']
// `dist` is the build's own output; `node_modules` and `.rslib` are not inputs
// either. `tsc -b` also rewrites `*.tsbuildinfo` on every run, so leaving those
// in the signature would make it change every time and nothing would ever be
// reused.
const BUILD_OUTPUTS = new Set(['node_modules', 'dist', '.rslib', '.rstack', '.cache'])
const isBuildArtifact = name => name.endsWith('.tsbuildinfo')

/** Newest input of the package build and of the packer that stages it. */
function inputsSignature(root) {
  let signature = Math.max(
    fileMtime(path.join(root, 'package.json')),
    fileMtime(path.join(root, 'nub.lock')),
    // the packer decides what lands in the tarballs; this module only
    // orchestrates, so editing it should not force a rebuild
    fileMtime(path.join(root, 'scripts/release.mjs')),
  )
  for (const name of PACKAGES)
    signature = Math.max(signature, maxMtime(path.join(root, 'packages', name), BUILD_OUTPUTS, isBuildArtifact))
  return signature
}

/**
 * An interrupted run (Ctrl-C, a closed terminal, an aborted tool call) never
 * reaches the `finally`, and `nub add --no-save` leaves its rewrite of
 * package.json and nub.lock behind. Recognise our own leftovers by the tarball
 * path and undo them, instead of failing or stacking a second switch on top.
 */
function restoreInterruptedRun(appDir) {
  let text
  try {
    text = readFileSync(path.join(appDir, 'package.json'), 'utf8')
  }
  catch {
    return
  }
  if (!text.includes('.release/artifacts') && !text.includes('.release\\artifacts'))
    return
  step('an earlier run was interrupted — restoring the app first')
  execFileSync('git', ['checkout', '--', 'package.json', 'nub.lock'], { cwd: appDir, stdio: 'inherit' })
  run('nub', ['install'], appDir)
}

export function switchToReleaseState(root, appDir, { force = false } = {}) {
  restoreInterruptedRun(appDir)

  const versions = new Set(PACKAGES.map(name => readJson(path.join(root, 'packages', name, 'package.json')).version))
  if (versions.size !== 1)
    fail(`packages/* are not in lockstep: ${[...versions].join(', ')}`)
  const version = [...versions][0]

  const artifacts = path.join(root, 'node_modules', '.release', 'artifacts')
  const tarballs = PACKAGES.map(name => path.join(artifacts, `lynx-solid-${name}-${version}.tgz`))
  const stampFile = path.join(root, 'node_modules', '.release', 'verify-stamp.json')

  const signature = inputsSignature(root)
  const stamps = readStamps(stampFile)
  const reusable = !force && stamps.prepare === signature && tarballs.every(file => existsSync(file))

  if (reusable) {
    step(`reusing the packed @lynx-solid/*@${version} — inputs unchanged since the last run (--force to rebuild)`)
  }
  else {
    step('building the workspace packages')
    run('nub', ['run', 'build'], root)

    step(`packing @lynx-solid/*@${version} the way publish would`)
    run('node', ['scripts/release.mjs', '--dry-run'], root)
    for (const file of tarballs) {
      if (!existsSync(file))
        fail(`release.mjs did not produce ${file}`)
    }
    // Recorded after the build, so anything the build writes that the skip list
    // does not know about is absorbed into the stamp instead of making the
    // signature differ on every run.
    saveStamps(stampFile, { ...stamps, prepare: inputsSignature(root) })
  }

  // Everything the app shares with the repository moves to the
  // repository's value: the catalog is the source of truth, the root manifest
  // covers what it does not list (`@solidjs/signals`).
  const rootPkg = readJson(path.join(root, 'package.json'))
  const catalog = rootPkg.workspaces?.catalog ?? {}
  const repoVersions = { ...rootPkg.dependencies, ...rootPkg.devDependencies, ...catalog }
  const manifest = readJson(path.join(appDir, 'package.json'))
  const companions = []
  for (const [name, spec] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    // our own packages come from the tarballs, and the root manifest only
    // describes them as `workspace:*`
    if (name.startsWith('@lynx-solid/'))
      continue
    const wanted = repoVersions[name]
    if (!wanted || wanted === 'catalog:' || wanted === spec)
      continue
    // the repository's own spec: exact for the pinned packages, a range for
    // the rest (`^5.5.0` has no `5.5.0` release to pin to)
    companions.push({ name, spec: wanted, was: spec })
  }

  const name = path.relative(root, appDir)
  step(`switching ${name} to the release state (@lynx-solid/* -> ${version})`)
  for (const companion of companions)
    console.log(`  ${companion.name} ${companion.spec} (was ${companion.was})`)

  // The app uses whatever registry npm is configured with; `VERIFY_REGISTRY`
  // pins a different one for this run. There is deliberately no automatic
  // fallback — a registry that cannot serve a packument is a real failure, and
  // retrying against a second one hides the error behind a minute of backoff.
  const registry = process.env.VERIFY_REGISTRY
  const tarballSpecs = tarballs.map(file => `file:${file}`)
  const specs = companions.map(({ name, spec }) => `${name}@${spec}`)
  try {
    run('nub', ['add', '--no-save', ...(registry ? ['--registry', registry] : []), ...tarballSpecs, ...specs], appDir)
  }
  catch {
    fail('installing the release state failed — the registry could not serve one of the packuments (see the error above)')
  }

  return { version, companions }
}

/**
 * Assert the tree the app actually got. `nub add --no-save` can succeed and
 * a later `nub run` still reinstall from the lockfile (nub does that when the
 * Node major changed), so without this a silent revert turns the run green.
 */
export function assertInstalled(appDir, companions) {
  const asserted = []
  for (const { name, spec } of companions) {
    // A range needs a semver implementation to compare; the exact pins are the
    // ones that carry the release (`solid-js`, the build chain).
    if (/^[\^~]/.test(spec)) {
      console.log(`  ${name} ${spec} — range, not asserted`)
      continue
    }
    let installed
    try {
      installed = readJson(path.join(appDir, 'node_modules', name, 'package.json')).version
    }
    catch {
      fail(`${name} is not installed in the app — the release state did not take`)
    }
    if (installed !== spec)
      fail(`${name} is ${installed}, expected ${spec} — the release state did not take (a reinstall may have reverted it)`)
    asserted.push(`${name}@${spec}`)
  }
  console.log(`  release state in place: ${asserted.join(', ')}`)
}

export function restoreLockfile(root, appDir) {
  const name = path.relative(root, appDir)
  try {
    step('restoring node_modules from the lockfile')
    run('nub', ['install'], appDir)
    // Content, not status: `nub run android` rewrites a few generated Gradle
    // files with the same bytes and a different line ending, which git reports
    // as modified until it re-reads them.
    for (const args of [['diff', '--quiet', '--', name], ['diff', '--cached', '--quiet', '--', name]]) {
      try {
        execFileSync('git', args, { cwd: root, stdio: 'ignore' })
      }
      catch {
        console.error(`warning: ${name} has content changes after the run — inspect them before committing`)
      }
    }
  }
  catch (error) {
    // The run's own result is already on the exit code; a broken cleanup must
    // not hide it.
    console.error(`cleanup failed, ${name} may be left in the release state: ${error.message}`)
  }
}
