/**
 * Pre-build script that scans local examples and generates metadata + copies
 * source files to docs/public/examples/ for the <Go> component to consume.
 *
 * Adapted from the prepare-examples step of the vue-lynx docs site
 * (https://github.com/Huxpro/vue-lynx, Apache-2.0): instead of publishing
 * @lynx-example/* npm packages, local examples/ sources and their
 * prebuilt dist/ bundles are copied verbatim so <Go> can show code (text
 * files), run the web preview (*.web.bundle) and offer the QR/native bundle
 * (*.lynx.bundle) straight from the docs site.
 *
 * dist/ is gitignored, so this script owns it: an arm is rebuilt when it is
 * missing, when it carries dev-form output, or when the inputs it was last
 * built from (the example's sources plus the library packages it inlines) no
 * longer match — the inputs are recorded in `website/.cache/` at build time,
 * so nothing has to be deleted by hand. Pass `--force` (or
 * PREPARE_EXAMPLES_FORCE=1) to rebuild every arm regardless.
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEBSITE_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(WEBSITE_ROOT, '..')
const EXAMPLES_SRC = path.resolve(REPO_ROOT, 'examples')
const EXAMPLES_DEST = path.resolve(WEBSITE_ROOT, 'docs/public/examples')
// The docs repo currently has no git remote, so there is no canonical
// source URL for the footer's GitHub button. Leave it unset (the button is
// hidden) until the repo is published, then point it at
// `https://github.com/<org>/<repo>/tree/main/examples`.
const EXAMPLE_GIT_BASE_URL = ''

// Example bundles inline the library packages, so rebuilding the lib makes
// every arm stale even when no example source changed. [src, dist] pairs.
const LIB_PACKAGES = [
  ['packages/plugin/src', 'packages/plugin/dist'],
  ['packages/runtime/src', 'packages/runtime/dist'],
  ['packages/compiler/src', 'packages/compiler/dist'],
  ['packages/compiler/babel-plugin-jsx-lynx/src', 'packages/compiler/babel-plugin-jsx-lynx/dist'],
].map(([src, dist]) => ({ src: path.join(REPO_ROOT, src), dist: path.join(REPO_ROOT, dist) }))

// A dependency bump changes what the bundler emits without touching any source
// file, so the root lockfile counts as an input to every arm as well.
const DEP_LOCKFILE = path.join(REPO_ROOT, 'nub.lock')

// On hosting with slow native fetchers, pre-gzip *.lynx.bundle so QR/device
// fetches stay small. Off by default locally.
const PRE_GZIP_LYNX_BUNDLES = Boolean(process.env.PRE_GZIP_LYNX_BUNDLES)

// Rebuild every arm, ignoring mtimes — the escape hatch for "I want it fresh".
const FORCE_REBUILD = process.argv.includes('--force') || Boolean(process.env.PREPARE_EXAMPLES_FORCE)

// File extensions to skip (binary assets in src/)
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.svg',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.mkv',
  '.webm',
  '.ttf',
  '.woff',
  '.woff2',
  '.eot',
  '.otf',
  '.zip',
  '.tar',
  '.tgz',
  '.gz',
  '.rar',
  '.pdf',
  '.psd',
  '.tif',
])

// Directories to skip
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-ifr', '.cache', '.git', '.data', '.lynx', '.rspeedy', '.rslib'])

// Examples the MT-IFR guide embeds with the IFR arm on. Their configs read
// `LYNX_MT_IFR` (the switch and the output dir both follow it), so the second
// arm is a build of the same source — never a copy of the example. Keep this
// list in sync with the <Go> tags at the bottom of docs/guide/mt-ifr.mdx.
const IFR_EMBEDS = new Set([
  'counter',
  'todomvc',
  '7guis',
  'style-demo',
  'tailwind',
  'motion',
  'scrolling',
  'networking',
  'hackernews',
  'elk',
])

/**
 * Walk a directory recursively and collect relative file paths.
 */
function walkDir(dir, base = dir) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name))
      continue

    const fullPath = path.join(dir, entry.name)
    // Normalize to posix separators: `files` become URL path segments for
    // the <Go> file browser, so Windows backslashes would break fetching.
    const relPath = path.relative(base, fullPath).replaceAll('\\', '/')

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, base))
    }
    else {
      results.push(relPath)
    }
  }
  return results
}

/**
 * Recursively copy a directory (no filtering).
 */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    }
    else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Check if a file is a preview image at the example root.
 */
function isPreviewImage(relPath) {
  const basename = path.basename(relPath)
  return /^preview-image\.(?:png|jpg|jpeg|webp|gif)$/.test(basename)
    && !relPath.includes('/')
}

/**
 * Check if a file is a text source file we should copy.
 */
function isTextFile(relPath) {
  const ext = path.extname(relPath).toLowerCase()
  if (BINARY_EXTENSIONS.has(ext))
    return false
  return true
}

/**
 * Parse rsbuild.config.ts to extract entry points for templateFiles.
 * Simple regex-based parser — good enough for the standard config format
 * (`entry: { 'name': './path', ... }`).
 */
function parseEntries(configPath) {
  if (!fs.existsSync(configPath))
    return []

  const content = fs.readFileSync(configPath, 'utf-8')

  // Match entry object: entry: { 'name': './path', ... }
  const entryMatch = content.match(/entry:\s*\{([^}]+)\}/)
  if (!entryMatch)
    return []

  const entries = []
  const entryRegex = /['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g
  for (const match of entryMatch[1].matchAll(entryRegex)) {
    entries.push({ name: match[1], entryPath: match[2] })
  }
  return entries
}

/**
 * Process a single example directory.
 */
function processExample(exampleName) {
  const srcDir = path.join(EXAMPLES_SRC, exampleName)
  const destDir = path.join(EXAMPLES_DEST, exampleName)

  if (!fs.statSync(srcDir).isDirectory())
    return

  console.info(`Processing example: ${exampleName}`)

  // Collect all files
  const allFiles = walkDir(srcDir)

  // Filter to text source files (skip binary assets)
  const textFiles = allFiles.filter((f) => {
    // Always include preview images
    if (isPreviewImage(f))
      return true
    // Skip binary files
    if (!isTextFile(f))
      return false
    return true
  })

  // Find preview image
  const previewImage = allFiles.find(isPreviewImage) || undefined

  // Parse entries from rsbuild.config.ts
  const configPath = path.join(srcDir, 'rsbuild.config.ts')
  const entries = parseEntries(configPath)

  // Build templateFiles (pointing to expected bundle locations).
  // The Lynx engine emits dist/<name>.lynx.bundle (native) and
  // dist/<name>.web.bundle (web preview) per entry.
  const templateFiles = entries.map(({ name }) => {
    const entry = {
      name,
      file: `dist/${name}.lynx.bundle`,
    }
    const webBundlePath = path.join(srcDir, `dist/${name}.web.bundle`)
    if (fs.existsSync(webBundlePath)) {
      entry.webFile = `dist/${name}.web.bundle`
    }
    return entry
  })

  // The IFR arm of the same example (the same config built with
  // `LYNX_MT_IFR=1`) is published beside the shipped one under its own entry
  // name, so a page can select it with `defaultEntryFile` while every other
  // page keeps the default arm. It reuses the shipped web bundle: the web host
  // has no main thread to paint the first screen on, so both builds are the
  // same app there.
  for (const entry of [...templateFiles]) {
    const ifrFile = `dist/${entry.name}.ifr.lynx.bundle`
    if (!fs.existsSync(path.join(srcDir, 'dist-ifr', `${entry.name}.lynx.bundle`)))
      continue
    templateFiles.push({
      name: `${entry.name}-ifr`,
      file: ifrFile,
      ...(entry.webFile ? { webFile: entry.webFile } : {}),
    })
  }

  // Build metadata
  const metadata = {
    name: exampleName,
    files: textFiles.filter(f => !isPreviewImage(f)),
    templateFiles,
    previewImage: previewImage || undefined,
  }
  if (EXAMPLE_GIT_BASE_URL) {
    metadata.exampleGitBaseUrl = EXAMPLE_GIT_BASE_URL
  }

  // Ensure destination exists
  fs.mkdirSync(destDir, { recursive: true })

  // Write metadata
  fs.writeFileSync(
    path.join(destDir, 'example-metadata.json'),
    JSON.stringify(metadata, null, 2),
  )

  // Copy text files
  for (const relPath of textFiles) {
    const srcFile = path.join(srcDir, relPath)
    const destFile = path.join(destDir, relPath)
    fs.mkdirSync(path.dirname(destFile), { recursive: true })
    fs.copyFileSync(srcFile, destFile)
  }

  // Copy entire dist/ (bundles + static assets referenced by bundles)
  const distSrcDir = path.join(srcDir, 'dist')
  const distDestDir = path.join(destDir, 'dist')
  if (fs.existsSync(distSrcDir)) {
    // Second gate right before copying: `rsbuild dev` may have rewritten dist
    // after the top-level gate ran.
    const evidence = findDevFormEvidence(distSrcDir)
    if (evidence.length) {
      console.error(`✗ ${exampleName}: dist went dev-form during prepare (${evidence.join(', ')})`)
      console.error('  stop the example dev server (pm2 stop dev-*), rebuild it, then rerun')
      process.exit(1)
    }
    copyDirRecursive(distSrcDir, distDestDir)
    // The IFR arm is built into its own directory by the example's config (see
    // LYNX_MT_IFR there); publish it inside dist/ under a suffix so it travels
    // with the static assets it references.
    const ifrSrcDir = path.join(srcDir, 'dist-ifr')
    if (fs.existsSync(ifrSrcDir)) {
      const ifrEvidence = findDevFormEvidence(ifrSrcDir)
      if (ifrEvidence.length) {
        console.error(`✗ ${exampleName}: dist-ifr went dev-form during prepare (${ifrEvidence.join(', ')})`)
        console.error('  stop the example dev server (pm2 stop dev-*), rebuild it, then rerun')
        process.exit(1)
      }
      for (const file of fs.readdirSync(ifrSrcDir)) {
        if (!file.endsWith('.lynx.bundle'))
          continue
        fs.copyFileSync(
          path.join(ifrSrcDir, file),
          path.join(distDestDir, file.replace(/\.lynx\.bundle$/, '.ifr.lynx.bundle')),
        )
      }
    }
    if (PRE_GZIP_LYNX_BUNDLES) {
      gzipLynxBundlesInPlace(distDestDir)
    }
  }
  else {
    console.warn(`  ⚠ ${exampleName} has no dist/ — code will show, but web preview / QR bundles will be missing until the example is built`)
  }

  // Copy preview image if it exists
  if (previewImage) {
    const srcFile = path.join(srcDir, previewImage)
    const destFile = path.join(destDir, previewImage)
    fs.copyFileSync(srcFile, destFile)
  }

  console.info(`  -> ${textFiles.length} files, ${templateFiles.length} entries`)
}

/**
 * Replace each *.lynx.bundle with its gzip payload (same filename).
 * Pair with a Content-Encoding: gzip header so HTTP clients inflate.
 */
function gzipLynxBundlesInPlace(dir) {
  if (!fs.existsSync(dir))
    return

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      gzipLynxBundlesInPlace(fullPath)
      continue
    }
    if (!entry.name.endsWith('.lynx.bundle'))
      continue

    const raw = fs.readFileSync(fullPath)
    // Already gzipped (magic 1f 8b) — leave as-is so re-runs are idempotent.
    if (raw.length >= 2 && raw[0] === 0x1F && raw[1] === 0x8B)
      continue

    const compressed = gzipSync(raw, { level: 9 })
    fs.writeFileSync(fullPath, compressed)
    const ratio = raw.length === 0 ? 0 : compressed.length / raw.length
    console.info(
      `  gzip ${entry.name}: ${raw.length} -> ${compressed.length} bytes (${(ratio * 100).toFixed(1)}%)`,
    )
  }
}

// ---------------------------------------------------------------------------
// Freshness: dev-form dist detection + rebuild planning.
// A dev server (dev.writeToDisk defaults true) writes development bundles
// straight into examples/<name>/dist/ — unminified, carrying
// __DEBUG_METADATA_RELEASE__ (lynx env) / a readable rspack module map (web
// env) and a dist/.lynx/ work dir. Packaging those would ship dev bundles into
// the docs site, so an arm showing that evidence is rebuilt from scratch; if it
// still looks dev-form after the rebuild, a dev server owns the directory and
// the run hard-fails.
// ---------------------------------------------------------------------------

const DEV_MARKERS = [
  '__DEBUG_METADATA_RELEASE__', // debug-metadata banner (lynx environment)
  'var __webpack_modules__ = ', // unminified rspack runtime (web environment)
]

/**
 * Newest file mtime under dir. The directory's own mtime is unreliable:
 * overwriting an existing file does not touch it — always take the max over
 * the files inside.
 */
function maxMtime(dir, skipDirs = SKIP_DIRS, skipFile = () => false) {
  let max = 0
  if (!fs.existsSync(dir))
    return max
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name) || skipFile(entry.name))
      continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      max = Math.max(max, maxMtime(full, skipDirs, skipFile))
    }
    else {
      try {
        max = Math.max(max, fs.statSync(full).mtimeMs)
      }
      catch {}
    }
  }
  return max
}

/** mtime of a single file (0 when it is missing). */
function fileMtime(file) {
  try {
    return fs.statSync(file).mtimeMs
  }
  catch {
    return 0
  }
}

/**
 * Dev-form evidence inside an example's dist: marker strings in the
 * consumable bundles, or the build-engine work dir that production builds
 * clean away. Returns human-readable hits (empty = clean).
 *
 * The work dir was renamed `.rspeedy` -> `.lynx` by the engine (lynx-stack#3682).
 * Both names are checked: old dists still carry the old one, and checking only
 * the current name would let a fresh dev run slip through.
 */
function findDevFormEvidence(distDir) {
  const hits = []
  for (const workDir of ['.lynx', '.rspeedy']) {
    if (fs.existsSync(path.join(distDir, workDir)))
      hits.push(`${workDir}/ (dev work dir)`)
  }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.lynx.bundle') && !entry.name.endsWith('.web.bundle'))
        continue
      try {
        const buf = fs.readFileSync(full)
        if (DEV_MARKERS.some(m => buf.includes(m)))
          hits.push(entry.name)
      }
      catch {}
    }
  }
  walk(distDir)
  return hits
}

/** Source files that never affect bundles (avoid stale-warning noise). */
function isNonBuildInput(name) {
  return name.endsWith('.md') || /^preview-image\./.test(name)
}

// Which arm was built from which inputs. Comparing a bundle's mtime against its
// sources' mtime does not converge: a bundler is free to leave an unchanged
// output alone, and checked-out files can carry mtimes that a build never
// overtakes. Recording the input signature at build time is stable across both.
const STAMP_FILE = path.join(WEBSITE_ROOT, '.cache/prepare-examples.json')

function readStamps() {
  try {
    return JSON.parse(fs.readFileSync(STAMP_FILE, 'utf-8'))
  }
  catch {
    return {}
  }
}

function saveStamps(stamps) {
  fs.mkdirSync(path.dirname(STAMP_FILE), { recursive: true })
  fs.writeFileSync(STAMP_FILE, `${JSON.stringify(stamps, null, 2)}\n`)
}

/** Newest input of the library packages: their sources plus the lockfile. */
function libSignature() {
  return LIB_PACKAGES.reduce(
    (max, { src }) => Math.max(max, maxMtime(src)),
    fileMtime(DEP_LOCKFILE),
  )
}

/** Newest build output across the library packages (an input to every arm). */
function libDistMtime() {
  return LIB_PACKAGES.reduce((max, { dist }) => Math.max(max, maxMtime(dist)), 0)
}

/**
 * Decide which example arms need a build.
 *
 * An arm is rebuilt when it is missing, when it carries dev-form output, or when
 * the inputs it was last built from (the example's sources, the lockfile, and
 * the library packages it inlines) no longer match. `--force` rebuilds
 * everything.
 */
function planBuilds(examples, stamps) {
  const libM = libDistMtime()
  const todo = []
  for (const example of examples) {
    const exampleDir = path.join(EXAMPLES_SRC, example)
    const sig = Math.max(
      maxMtime(exampleDir, SKIP_DIRS, isNonBuildInput),
      libM,
      fileMtime(DEP_LOCKFILE),
    )
    const arms = [
      { dir: 'dist', env: {}, label: '' },
      ...(IFR_EMBEDS.has(example) ? [{ dir: 'dist-ifr', env: { LYNX_MT_IFR: '1' }, label: ' (IFR arm)' }] : []),
    ]
    for (const arm of arms) {
      const outDir = path.join(exampleDir, arm.dir)
      const key = `${example}/${arm.dir}`
      let reason = null
      if (FORCE_REBUILD) {
        reason = 'forced'
      }
      else if (!fs.existsSync(outDir)) {
        reason = 'not built yet'
      }
      else if (findDevFormEvidence(outDir).length > 0) {
        reason = 'dev-form output'
      }
      else if (stamps[key] !== sig) {
        reason = 'build inputs changed'
      }
      if (reason)
        todo.push({ example, dir: arm.dir, env: arm.env, label: arm.label, reason, key, sig })
    }
  }
  return todo
}

// Main
console.info('Preparing examples...')
console.info(`Source: ${EXAMPLES_SRC}`)
console.info(`Dest:   ${EXAMPLES_DEST}`)

// Discover example directories (require package.json — node_modules husks of
// deleted examples linger in working trees and must not be processed/warned)
const examples = fs.readdirSync(EXAMPLES_SRC, { withFileTypes: true })
  .filter(d =>
    d.isDirectory()
    && !SKIP_DIRS.has(d.name)
    && fs.existsSync(path.join(EXAMPLES_SRC, d.name, 'package.json')),
  )
  .map(d => d.name)

const stamps = readStamps()

// Examples depend on @lynx-solid/* (workspace:*) and inline them, so the library
// has to be rebuilt before any arm when its sources moved on.
const libSig = libSignature()
if (FORCE_REBUILD || stamps.lib !== libSig) {
  console.info(FORCE_REBUILD
    ? 'Rebuilding the library packages (--force)...'
    : 'Library sources changed — rebuilding packages first...')
  execSync('nub run build', { cwd: REPO_ROOT, stdio: 'inherit' })
  stamps.lib = libSig
  saveStamps(stamps)
}

// Plan BEFORE touching the destination: a failed build then still leaves the
// previous docs/public/examples intact for dev/preview.
const builds = planBuilds(examples, stamps)

for (const { example, dir, env, label, reason, key, sig } of builds) {
  const outDir = path.join(EXAMPLES_SRC, example, dir)
  // Wipe the arm first. rsbuild overwrites the files it emits but never removes
  // the ones a previous build or dev run left behind; those would be published
  // next to the fresh bundles.
  fs.rmSync(outDir, { recursive: true, force: true })
  console.info(`Building example: ${example}${label} (${reason})`)
  try {
    execSync('nub run build', {
      cwd: path.join(EXAMPLES_SRC, example),
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
    stamps[key] = sig
    saveStamps(stamps)
  }
  catch (err) {
    console.error(`  ⚠ Failed to build ${example}${label}:`, err.message)
  }
}

// Dev-form output this late means a dev server rewrote the arm while we built
// (or the build failed outright): refuse to publish it.
const stillDirty = builds.filter(({ example, dir }) => {
  const outDir = path.join(EXAMPLES_SRC, example, dir)
  return fs.existsSync(outDir) && findDevFormEvidence(outDir).length > 0
})
if (stillDirty.length > 0) {
  console.error('\n✗ dev-form dist still present after rebuilding — is an example dev server running?')
  for (const { example, dir } of stillDirty)
    console.error(`  - ${example}: ${dir}/`)
  console.error('Stop it (pm2 stop dev-*), then rerun:')
  console.error('  nub run -F @lynx-solid/website build')
  process.exit(1)
}

// Clean destination
if (fs.existsSync(EXAMPLES_DEST)) {
  fs.rmSync(EXAMPLES_DEST, { recursive: true })
}
fs.mkdirSync(EXAMPLES_DEST, { recursive: true })

// Process each example
for (const example of examples) {
  processExample(example)
}

// The MT-IFR guide's embeds default to the IFR entry; a missing arm would fall
// back to the shipped build without saying so, and the page would show the
// wrong bundle under a table measured on the IFR one. Fail instead.
const missingIfr = [...IFR_EMBEDS].filter((example) => {
  const distDir = path.join(EXAMPLES_DEST, example, 'dist')
  return !fs.existsSync(distDir)
    || !fs.readdirSync(distDir).some(f => f.endsWith('.ifr.lynx.bundle'))
})
if (missingIfr.length > 0) {
  console.error(`\n✗ no IFR arm published for: ${missingIfr.join(', ')}`)
  console.error('  docs/guide/mt-ifr.mdx embeds default to them; build with:')
  console.error('  LYNX_MT_IFR=1 nub run -F @lynx-solid/dev-<example> build')
  process.exit(1)
}

console.info(`\nDone! Processed ${examples.length} examples.`)
