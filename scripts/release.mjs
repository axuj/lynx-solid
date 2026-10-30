/**
 * Stage and publish the public packages (@lynx-solid/runtime|compiler|plugin).
 *
 * Source manifests are workspace-native: inter-package deps use `workspace:*`
 * and registry versions use `catalog:`. Neither npm nor the registry understand
 * those specifiers, and `npm publish` does not rewrite them, so this script
 * stages each package into a scratch directory with a materialized manifest,
 * verifies the tarball surface, and only then packs/publishes the staged copy.
 *
 * Usage:
 *   node scripts/release.mjs --dry-run
 *   node scripts/release.mjs --publish --tag latest [--provenance] [--otp 123456]
 *   node scripts/release.mjs --publish --registry=https://registry.npmjs.org/
 *
 * Build first: `nub run build` (or let CI do it). Staged output lives in
 * `<repo>/node_modules/.release/`, so nothing lands in the working tree.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = ['runtime', 'compiler', 'plugin']
const rootPkg = readJson(path.join(root, 'package.json'))
const catalog = rootPkg.workspaces?.catalog ?? {}

const argv = process.argv.slice(2)
function has(name) {
  return argv.includes(`--${name}`)
}
function opt(name, fallback) {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit)
    return fallback
  if (hit === `--${name}`) {
    const i = argv.indexOf(hit)
    return argv[i + 1] ?? fallback
  }
  return hit.slice(name.length + 3)
}

const dryRun = has('dry-run') || !has('publish')
const tag = opt('tag', 'latest')
const registry = opt('registry', 'https://registry.npmjs.org/')
const otp = opt('otp')
const provenance = has('provenance')

// On Windows `npm` is a .cmd shim that execFile cannot spawn directly, so drive
// the CLI through the running node binary instead. Falls back to PATH elsewhere.
const npmCli = path.resolve(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const npm = existsSync(npmCli) ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm')
const npmPrefix = existsSync(npmCli) ? [npmCli] : []

function fail(msg) {
  throw new Error(msg)
}
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

const manifests = new Map()
for (const name of PACKAGES) {
  const dir = path.join(root, 'packages', name)
  manifests.set(name, { dir, pkg: readJson(path.join(dir, 'package.json')) })
}

// All public packages are released in lockstep: one version, one tag.
const versions = new Set([...manifests.values()].map(m => m.pkg.version))
if (versions.size !== 1)
  fail(`package versions are not in lockstep: ${[...versions].join(', ')}`)
const version = [...versions][0]

const byPackageName = new Map([...manifests.values()].map(m => [m.pkg.name, m.pkg]))

/**
 * Turn a workspace-native specifier into what the registry should see.
 * Peer deps get a caret on bare versions: the published peer is a compatibility
 * range, not the exact catalog pin used to build the repo.
 */
function materialize(dep, spec, field) {
  let out = spec
  if (spec === 'catalog:') {
    out = catalog[dep] ?? fail(`catalog has no entry for "${dep}"`)
  }
  else if (spec.startsWith('catalog:')) {
    const named = spec.slice('catalog:'.length)
    out = rootPkg.workspaces?.catalogs?.[named]?.[dep] ?? fail(`catalog "${named}" has no entry for "${dep}"`)
  }
  else if (spec.startsWith('workspace:')) {
    const range = spec.slice('workspace:'.length)
    const target = byPackageName.get(dep) ?? fail(`workspace dep "${dep}" is not one of ${PACKAGES.join(', ')}`)
    if (range === '*')
      out = `^${target.version}`
    else if (range === '^' || range === '~')
      out = `${range}${target.version}`
    else
      out = range
  }
  if (field === 'peerDependencies' && /^\d/.test(out))
    out = `^${out}`
  return out
}

function stagePackage(name) {
  const { dir, pkg } = manifests.get(name)
  const stageDir = path.join(root, 'node_modules', '.release', `${pkg.name.replace(/^@/, '').replace('/', '-')}@${pkg.version}`)

  rmSync(stageDir, { recursive: true, force: true })
  mkdirSync(stageDir, { recursive: true })

  for (const entry of pkg.files ?? ['dist']) {
    const from = path.join(dir, entry)
    if (!existsSync(from))
      fail(`${pkg.name}: "${entry}" is missing — run \`nub run build\` first`)
    cpSync(from, path.join(stageDir, entry), { recursive: true })
  }

  const license = path.join(root, 'LICENSE')
  if (!existsSync(license))
    fail('root LICENSE is missing')
  cpSync(license, path.join(stageDir, 'LICENSE'))

  const readme = path.join(dir, 'README.md')
  if (!existsSync(readme))
    fail(`${pkg.name}: packages/${name}/README.md is missing (npm renders it as the package page)`)
  cpSync(readme, path.join(stageDir, 'README.md'))

  const out = structuredClone(pkg)
  delete out.private
  out.publishConfig = { ...out.publishConfig, access: 'public' }
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    if (!out[field])
      continue
    for (const [dep, spec] of Object.entries(out[field]))
      out[field][dep] = materialize(dep, spec, field)
  }

  const text = `${JSON.stringify(out, null, 2)}\n`
  for (const forbidden of ['workspace:', 'catalog:']) {
    if (text.includes(forbidden))
      fail(`${pkg.name}: staged manifest still contains "${forbidden}"`)
  }
  writeFileSync(path.join(stageDir, 'package.json'), text)

  verifyPackage(stageDir, out)
  console.log(`staged ${out.name}@${out.version} -> ${path.relative(root, stageDir)}`)
  return { stageDir, pkg: out }
}

/** Fail before the registry does: every entry point named by the manifest must exist. */
function verifyPackage(stageDir, pkg) {
  const need = []
  if (pkg.main)
    need.push({ label: 'main', file: pkg.main })
  if (pkg.types)
    need.push({ label: 'types', file: pkg.types })
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    if (subpath === './package.json')
      continue
    if (typeof target === 'string') {
      need.push({ label: subpath, file: target })
      continue
    }
    for (const [condition, file] of Object.entries(target)) {
      if (typeof file === 'string' && file.startsWith('./'))
        need.push({ label: `${subpath} (${condition})`, file })
    }
  }
  for (const { label, file } of need) {
    if (!existsSync(path.join(stageDir, file)))
      fail(`${pkg.name}: export target missing from the tarball: ${label} -> ${file}`)
  }

  const dist = path.join(stageDir, 'dist')
  if (!existsSync(dist) || readdirSync(dist).length === 0)
    fail(`${pkg.name}: dist/ is empty`)
  if (pkg.name === '@lynx-solid/compiler' && !existsSync(path.join(dist, 'jsx-lynx.cjs')))
    fail(`${pkg.name}: dist/jsx-lynx.cjs is missing — the published compiler cannot compile JSX without it`)
}

const staged = PACKAGES.map(name => stagePackage(name))

/**
 * True when the registry already has this exact version. A tag-triggered
 * workflow must not fail just because the release was bootstrapped by hand.
 */
function alreadyPublished(name, version) {
  try {
    const out = execFileSync(npm, [...npmPrefix, 'view', `${name}@${version}`, 'version', '--registry', registry], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim() === version
  }
  catch {
    return false
  }
}

const artifacts = path.join(root, 'node_modules', '.release', 'artifacts')
mkdirSync(artifacts, { recursive: true })

for (const { stageDir, pkg } of staged) {
  const packed = execFileSync(npm, [...npmPrefix, 'pack', '--json', '--pack-destination', artifacts], {
    cwd: stageDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const [{ filename }] = JSON.parse(packed)
  const tarball = path.join(artifacts, filename)
  console.log(`packed  ${pkg.name}@${pkg.version} -> ${path.relative(root, tarball)} (${(statSync(tarball).size / 1024).toFixed(1)} KiB)`)

  if (!dryRun) {
    if (alreadyPublished(pkg.name, pkg.version)) {
      console.log(`skip    ${pkg.name}@${pkg.version} — already on the registry`)
      continue
    }
    const args = [...npmPrefix, 'publish', stageDir, '--access', 'public', '--tag', tag, '--registry', registry]
    if (provenance)
      args.push('--provenance')
    if (otp)
      args.push('--otp', otp)
    console.log(`publish ${pkg.name}@${pkg.version} (tag=${tag})`)
    execFileSync(npm, args, { cwd: root, stdio: 'inherit' })
  }
}

console.log(dryRun
  ? `\ndry run complete — ${PACKAGES.length} packages at ${version}, nothing uploaded.`
  : `\npublished ${PACKAGES.length} packages at ${version} with tag "${tag}".`)

// Keep the scratch root alive only for this run when dry-running, so the
// tarballs stay inspectable; CI cleans the whole node_modules anyway.
if (dryRun)
  console.log(`tarballs: ${path.relative(root, artifacts)}`)
else
  rmSync(path.join(root, 'node_modules', '.release'), { recursive: true, force: true })
