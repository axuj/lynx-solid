#!/usr/bin/env node
// The apps under `apps/` install *published* `@lynx-solid/*` packages, so they
// do not follow the repository by themselves: a release has to bump them. This
// check puts that bump in the same pull request as the version change, which is
// the only place where a red check is a direct consequence of the diff.
// Comparing against the registry would turn every unrelated pull request red for
// as long as the bump is missing, which is noise nobody acts on.
//
// The directory is the contract: anything under `apps/` is a real app with a
// native shell, installing published versions. That is why this scans the
// directory instead of reading a list out of the root manifest — a new app is
// checked the moment it appears, without a second place to keep in sync.
//
// The comparison is local and offline: every `@lynx-solid/*` dependency in an
// app must be `^<version in packages/*>`. Companion versions (`solid-js`, the
// Lynx build chain) are deliberately not checked: the repository catalog is
// ahead of the last release, so the only locally correct answer would be a
// pairing that has not been published. The app's lockfile is the record of the
// combination it was actually tested with.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const appsDir = path.join(root, 'apps')

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!existsSync(appsDir))
  fail('apps/ does not exist. The native apps live there; if they moved again, update this check with them.')

const apps = readdirSync(appsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(path.join(appsDir, entry.name, 'package.json')))
  .map(entry => `apps/${entry.name}`)
  .sort()

// Zero apps is a broken repository, not a pass — that is the state this check
// used to report as "nothing to check" while the directory was renamed.
if (apps.length === 0)
  fail('apps/ contains no app with a package.json. Nothing to check is a broken repository, not a pass.')

// `apps/*` has to stay outside the workspace: these install published versions
// instead of `workspace:*`, which is the whole reason they are not examples.
// There is no negation to keep in sync any more, so assert the absence rather
// than trusting a glob not to grow.
const workspaceEntries = readJson(path.join(root, 'package.json')).workspaces?.packages ?? []
const insideWorkspace = workspaceEntries.filter(entry => !entry.startsWith('!') && /^(?:apps(?:\/|$)|\*$|\*\*$)/.test(entry))
if (insideWorkspace.length > 0)
  fail(`the workspace includes apps/: ${insideWorkspace.join(', ')}. Apps install published @lynx-solid/* versions; remove the entry from workspaces.packages.`)

// `@lynx-solid/runtime` -> `0.1.1`, straight from the workspace package
const releases = new Map()
for (const entry of readdirSync(path.join(root, 'packages'))) {
  const manifest = path.join(root, 'packages', entry, 'package.json')
  try {
    const pkg = readJson(manifest)
    if (pkg.name && pkg.version)
      releases.set(pkg.name, pkg.version)
  }
  catch {
    // not a package directory
  }
}

const problems = []

for (const app of apps) {
  const pkg = readJson(path.join(root, app, 'package.json'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }

  for (const name of Object.keys(deps)) {
    if (!name.startsWith('@lynx-solid/'))
      continue

    const version = releases.get(name)
    if (version === undefined) {
      problems.push({ app, name, have: deps[name], want: 'a package in packages/*' })
      continue
    }

    const want = `^${version}`
    if (deps[name] !== want)
      problems.push({ app, name, have: deps[name], want })
  }
}

if (problems.length === 0) {
  console.log(`app pins match the workspace (${apps.join(', ')})`)
  process.exit(0)
}

for (const { app, name, have, want } of problems)
  console.error(`${app}: ${name} is ${have}, expected ${want}`)

console.error('\nBump the pins in the same pull request as the version change, then run `nub install` in the app.')
process.exit(1)
