// Dev-entry discovery: the lab mirrors examples/*, so a new sample app shows up
// in the sample list without hand-editing anything.
//
// Layout convention (matches each app's rsbuild.config.ts entry):
//   examples/<name>/src/index.tsx|ts  → single-file sample   (id "dev/<name>",
//                                     index.css rides along when present)
//     …unless src/ holds more than the index file, in which case it is a
//     multi-file project compiled as a whole (id "dev/<name>").
//
// Display names are the plain directory names (main, elk…)
// — no comment parsing, no magic.
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type DevEntryKind = 'file' | 'project'

export interface DevEntry {
  id: string
  name: string
  kind: DevEntryKind
  /** Absolute path of the entry source (the index file, both kinds). */
  codePath: string
  /** Absolute stylesheet riding along with a file entry, when present. */
  cssPath?: string
  /** Absolute project directory (kind === 'project'). */
  dirPath?: string
  /** Project directory basename — the build-tree entry name. */
  dirName?: string
}

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Absolute apps directory (the lab lives at <root>/compile-lab). */
export function devSrcDir(): string {
  return path.resolve(HERE, '../../../examples')
}

function indexFile(dir: string): string | undefined {
  for (const f of ['index.tsx', 'index.ts']) {
    if (existsSync(path.join(dir, f)))
      return f
  }
  return undefined
}

/** Absolute entry file of a project directory, or null. Exported for the builder. */
export function devProjectEntryFile(dir: string): string | null {
  const index = indexFile(dir)
  return index ? path.join(dir, index) : null
}

function fileEntry(id: string, name: string, codePath: string, cssPath: string): DevEntry {
  const entry: DevEntry = { id, name, kind: 'file', codePath }
  if (existsSync(cssPath))
    entry.cssPath = cssPath
  return entry
}

export function discoverDevEntries(): DevEntry[] {
  const apps = devSrcDir()
  const entries: DevEntry[] = []
  if (!existsSync(apps))
    return entries
  for (const name of readdirSync(apps).sort()) {
    if (name.startsWith('.'))
      continue
    const dir = path.join(apps, name)
    try {
      if (!statSync(dir).isDirectory())
        continue
    }
    catch {
      continue
    }
    const src = path.join(dir, 'src')
    const index = indexFile(src)
    if (!index)
      continue
    const codePath = path.join(src, index)
    // A src/ holding more than its index file is a multi-file project
    // (elk et al.) and compiles as a whole; otherwise it is one sample.
    const siblings = readdirSync(src).filter(f => f !== index && !f.startsWith('.'))
    if (siblings.length > 0) {
      entries.push({
        id: `dev/${name}`,
        name,
        kind: 'project',
        codePath,
        dirPath: dir,
        dirName: name,
      })
    }
    else {
      entries.push(fileEntry(
        `dev/${name}`,
        name,
        codePath,
        path.join(src, 'index.css'),
      ))
    }
  }
  return entries
}

function assertInside(src: string, target: string): boolean {
  const rel = path.relative(src, target)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Map lookup — unknown ids (including traversal attempts) miss. */
export function getDevEntry(id: string): DevEntry | undefined {
  return discoverDevEntries().find(e => e.id === id)
}

/** Validated project target for a project id, or null. */
export function devProjectTarget(id: string): { name: string, dir: string } | null {
  const entry = getDevEntry(id)
  if (!entry || entry.kind !== 'project' || !entry.dirPath || !entry.dirName)
    return null
  if (!assertInside(devSrcDir(), entry.dirPath))
    return null
  return { name: entry.dirName, dir: entry.dirPath }
}
