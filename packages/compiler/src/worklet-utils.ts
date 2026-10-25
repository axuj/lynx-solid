// Copyright 2026 Xuan Huang (huxpro). All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

// Ported from the equivalent worklet loader utilities in vue-lynx
// (https://github.com/Huxpro/vue-lynx — Apache-2.0, same author). Vue-only
// helpers were dropped
// on import:
// `stripStyleImports` (Vue SFC style sub-modules), `extractTemplateRegistrations`
// + `isInsideComment` (element-template registrations, needs TPL_REGISTER_GLOBAL).
//
// The import/export EDGE readers (extractImportSpecifiers, extractSharedImports,
// stripSharedImportAttributes) were re-implemented from the upstream regex
// scans to Babel AST passes: one parser, node-type dispatch, no grammar
// regexes to drift (upstream's grammar missed `export … from` roots; an AST
// walk covers every edge form by construction). Worklet-registration scanning
// and string helpers below remain verbatim upstream, reviewed there under
// biome (which doesn't flag them). Relax our stricter rules here so future
// re-syncs stay clean diffs.
/* eslint-disable no-cond-assign */

import { parse } from '@babel/parser'

/**
 * Resolve a specifier to an absolute path. Returns `null` when the
 * specifier cannot be resolved (the import is then skipped rather than
 * failing the build).
 */
export type ResolveImport = (specifier: string) => Promise<string | null>

/** Whether a resolved absolute path lives inside a `node_modules` tree. */
export function isUnderNodeModules(resolvedPath: string): boolean {
  return /[/\\]node_modules[/\\]/.test(resolvedPath)
}

/**
 * Reduce an import specifier to its package root: `@scope/name` or `name`,
 * dropping any subpath. Returns `null` for input with no usable package
 * segment (empty, or a bare `@scope` with no name).
 *
 *   - `@my-org/foo/dist/x` → `@my-org/foo`
 *   - `lodash/fp`          → `lodash`
 *
 * This is the canonical "package root" both worklet checkpoints reduce to
 * before matching the allowlist, so a specifier and a resolved path always
 * compare as the same input (see {@link isWorkletPackage}).
 */
export function packageRootFromSpecifier(specifier: string): string | null {
  const segments = specifier.split('/')
  const first = segments[0]
  if (!first)
    return null
  if (first.startsWith('@')) {
    const second = segments[1]
    return second ? `${first}/${second}` : null
  }
  return first
}

/**
 * Extract the package root from a resolved path under `node_modules`, or `null`
 * when the path is not under `node_modules`.
 *
 * Uses the LAST `node_modules` segment so nested deps and pnpm's
 * `…/.pnpm/<pkg>@<v>/node_modules/<pkg>/…` layout both resolve correctly, then
 * reduces the remainder via {@link packageRootFromSpecifier}.
 */
export function packageNameFromNodeModulesPath(
  resolvedPath: string,
): string | null {
  const norm = resolvedPath.replace(/\\/g, '/')
  const marker = '/node_modules/'
  const idx = norm.lastIndexOf(marker)
  if (idx === -1)
    return null
  return packageRootFromSpecifier(norm.slice(idx + marker.length))
}

/**
 * Match a package root against a single allowlist pattern. Inputs are already
 * reduced to a package root (see {@link packageRootFromSpecifier}), so:
 *   - strings match exactly (`@org/motion` ≠ `@org/motion-x`), and
 *   - RegExp patterns are tested against the root (`/^@org\//` matches
 *     `@org/motion`).
 */
function matchesPattern(
  packageRoot: string,
  pattern: string | RegExp,
): boolean {
  return pattern instanceof RegExp
    ? new RegExp(pattern.source, pattern.flags).test(packageRoot)
    : packageRoot === pattern
}

/**
 * Whether a package root is covered by the `includeWorkletPackages` allowlist.
 *
 * The single matcher used at both checkpoints — following import specifiers
 * ({@link extractLocalImports}) and the plugin's `node_modules` loader carve-out
 * — both of which reduce their input to a package root first, so a specifier
 * and a resolved path always compare as the same thing.
 *
 * @internal
 */
export function isWorkletPackage(
  packageRoot: string,
  allowlist: ReadonlyArray<string | RegExp>,
): boolean {
  for (const p of allowlist) {
    if (matchesPattern(packageRoot, p))
      return true
  }
  return false
}

/**
 * Babel-parse a module for the edge readers below. Same dialect set as
 * `compileDomModule` (typescript/jsx/importAttributes) so anything that
 * compiles also parses here; a syntax error throws with Babel's frame —
 * the fork compiler would reject the same file one pass later anyway.
 */
function parseModule(source: string): import('@babel/types').Program {
  return parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx', 'importAttributes'],
  }).program
}

/** An edge node carries a `with { runtime: 'shared' }` clause. */
function isSharedRuntimeAttr(
  node: { attributes?: ReadonlyArray<import('@babel/types').ImportAttribute> | null },
): boolean {
  return node.attributes?.some((attr) => {
    const key = attr.key.type === 'Identifier'
      ? attr.key.name
      : attr.key.type === 'StringLiteral' ? attr.key.value : null
    return key === 'runtime'
      && attr.value.type === 'StringLiteral'
      && attr.value.value === 'shared'
  }) ?? false
}

/**
 * Parse the import specifiers of a module that the MT graph may need to
 * follow.
 *
 * Returns deduplicated module paths (relative AND non-relative) after
 * dropping attribute imports (`… with { … }`) — shared imports are handled
 * by {@link extractSharedImports} instead. AST walk: every edge form
 * (`import … from`, bare `import '…'`, `export … from`) is a node type, so
 * no grammar form can silently fall out (the upstream regex missed
 * `export … from` roots). Output order keeps the upstream contract —
 * `from`-edges first (source order), then bare-only edges (source order) —
 * because extractLocalImports feeds the side-effect block from this list.
 */
export function extractImportSpecifiers(source: string): string[] {
  if (!source.includes('import') && !source.includes('export'))
    return []
  const program = parseModule(source)
  const seen = new Set<string>()
  const fromPaths: string[] = []
  const barePaths: string[] = []
  for (const node of program.body) {
    if (node.type === 'ImportDeclaration') {
      if (node.attributes?.length)
        continue // attribute edges belong to extractSharedImports
      if (seen.has(node.source.value))
        continue
      seen.add(node.source.value)
      if (node.specifiers.length === 0)
        barePaths.push(node.source.value)
      else fromPaths.push(node.source.value)
      continue
    }
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration')
      && node.source != null) {
      if (node.attributes?.length)
        continue
      if (seen.has(node.source.value))
        continue
      seen.add(node.source.value)
      fromPaths.push(node.source.value)
    }
  }
  return [...fromPaths, ...barePaths]
}
/**
 * Build the side-effect import block that preserves webpack's MT dependency
 * graph for a processed module.
 *
 * Converts each followed import to a side-effect-only import
 * (`import './foo'`) so webpack reaches sub-modules that contain worklet
 * registrations without executing user code or pulling in unrelated
 * packages. This is critical for the MT layer: entry files like `index.ts`
 * may not contain `'main thread'` directives themselves, but they import
 * `.ts` files that do.
 *
 * The follow policy (relative always, non-relative by resolved location,
 * `node_modules` only when allowlisted) is applied inline below.
 *
 * Unresolvable specifiers are skipped (never fail the build). The original
 * specifier string is re-emitted verbatim so the downstream bundler resolves
 * it again with its own alias/paths config.
 */
export async function extractLocalImports(
  source: string,
  resolveImport: ResolveImport,
  includeWorkletPackages: ReadonlyArray<string | RegExp> = [],
): Promise<string> {
  const kept: string[] = []

  for (const spec of extractImportSpecifiers(source)) {
    // Relative imports are always followed — no resolution needed.
    if (spec.startsWith('.')) {
      kept.push(spec)
      continue
    }

    // Non-relative: resolve to decide whether it's project/aliased source
    // (follow) or an external package (follow only when allowlisted).
    const resolved = await resolveImport(spec)
    if (resolved === null)
      continue // unresolvable → skip, don't fail build
    if (!isUnderNodeModules(resolved)) {
      kept.push(spec)
      continue
    }
    // Match the allowlist against the package ROOT (same input the plugin's
    // loader carve-out derives from the resolved path), so a specifier and a
    // path always compare as the same thing.
    const root = packageRootFromSpecifier(spec)
    if (root && isWorkletPackage(root, includeWorkletPackages))
      kept.push(spec)
  }

  if (kept.length === 0)
    return ''
  return kept.map(s => `import '${s}';`).join('\n')
}

/**
 * Quick check for an Element worklet directive (`'main thread'` or its
 * official `'main-thread'` alias). UI worklets (`'use worklet'`) are
 * deliberately NOT matched here — this gate feeds Element-only paths;
 * use {@link hasUIWorkletDirective} where the distinction matters.
 */
export function hasMainThreadDirective(source: string): boolean {
  return source.includes('\'main thread\'')
    || source.includes('"main thread"')
    || source.includes('\'main-thread\'')
    || source.includes('"main-thread"')
}

/** Quick check for the UI worklet directive (`'use worklet'`). */
export function hasUIWorkletDirective(source: string): boolean {
  return source.includes('\'use worklet\'')
    || source.includes('"use worklet"')
}

/**
 * Re-emit shared imports for the MT graph **with the import attribute
 * intact**: `import … from '…' with { runtime: 'shared' }`.
 *
 * The bundler matches `rules[].with: { runtime: 'shared' }` on the MT layer
 * (`solid:shared-root` / `solid:shared-cascade` in pluginSolidLynx) and
 * loads the target through the pass-through swc pipeline — never
 * worklet-mt-loader — so the module keeps its exports and can be
 * value-imported from other shared files (multi-hop). `'main thread'` on
 * the *target* is not required; the attribute is the contract.
 *
 * AST walk (no grammar regex): import, bare and `export … from` roots are
 * all re-emitted — the upstream regex missed the export form entirely, so a
 * barrel-style root edge died with `module has no exports` at link time.
 * Export roots collapse to a BARE edge on re-emit: the shell keeps its
 * no-exports invariant (nothing inside a shell can consume a re-export),
 * while the dependency edge itself is all the shared rule needs to match.
 *
 * `mtMacroLoader` is accepted for call-site compatibility and ignored —
 * per-thread macros ride the shared rule's loader chain instead.
 */
export function extractSharedImports(source: string, _mtMacroLoader?: string): string {
  // Cheap prefilter: virtually no module carries the attribute, and the
  // parse below only runs for those.
  if (!source.includes('runtime:'))
    return ''
  const program = parseModule(source)
  const imports: string[] = []
  for (const node of program.body) {
    if (node.type === 'ImportDeclaration') {
      if (!isSharedRuntimeAttr(node))
        continue
      const quote = source.slice(node.source.start!, node.source.start! + 1)
      const modulePath = node.source.value
      if (node.specifiers.length === 0) {
        // Bare side-effect form: preserve source order (shim eval order).
        imports.push(`import ${quote}${modulePath}${quote} with { runtime: 'shared' };`)
      }
      else {
        // `from` form: keep the specifier text byte-for-byte (multi-line
        // lists included) AND re-standardise the attribute so rule.with
        // matches the target module.
        const head = source.slice(node.start!, node.source.start!)
        const specifiers = head
          .replace(/^\s*import\s+/, '')
          .replace(/\s*from\s*$/, '')
        imports.push(`import ${specifiers} from ${quote}${modulePath}${quote} with { runtime: 'shared' };`)
      }
      continue
    }
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration')
      && node.source != null && isSharedRuntimeAttr(node)) {
      // Barrel-style root: the edge must survive the shell (or the shared
      // rule never sees it), but a shell must not grow exports — emit bare.
      const quote = source.slice(node.source.start!, node.source.start! + 1)
      imports.push(`import ${quote}${node.source.value}${quote} with { runtime: 'shared' };`)
    }
  }
  return imports.join('\n')
}

/**
 * Strip `with { runtime: 'shared' }` import attributes, keeping the import.
 *
 * AST splice: the statement head (through the module literal) is kept
 * byte-for-byte, the whole `with { … }` clause is cut, and a `;` is
 * normalised in — matching the old grammar replace (clause + optional `;`
 * → `;`). Works on `export … from` roots too (the grammar only learned
 * that form in its final revision).
 */
export function stripSharedImportAttributes(code: string): string {
  // Cheap prefilter: virtually no module carries the attribute, and the
  // parse below only runs for those.
  if (!code.includes('runtime:'))
    return code
  const program = parseModule(code)
  const cuts: { start: number, end: number, text: string }[] = []
  for (const node of program.body) {
    if (node.type !== 'ImportDeclaration'
      && node.type !== 'ExportNamedDeclaration'
      && node.type !== 'ExportAllDeclaration') {
      continue
    }
    if (node.source == null || !isSharedRuntimeAttr(node))
      continue
    cuts.push({
      start: node.start!,
      end: node.end!,
      text: `${code.slice(node.start!, node.source.end!)};`,
    })
  }
  if (cuts.length === 0)
    return code
  cuts.sort((a, b) => a.start - b.start)
  let out = ''
  let last = 0
  for (const cut of cuts) {
    out += code.slice(last, cut.start)
    out += cut.text
    last = cut.end
  }
  out += code.slice(last)
  return out
}

/**
 * Given the index of a '(' in `code`, return the index of its matching ')'.
 *
 * String/template literals are skipped so parens inside embedded text (e.g.
 * a baked `__SetAttribute(e, 'text', "call us :)")`) don't unbalance the
 * scan. Comments are skipped too: the LEPUS transform preserves user
 * comments inside worklet bodies, so an apostrophe or paren in a comment
 * (`// the finger's position (x)`) must not derail the literal-skipper —
 * before this, one such comment silently dropped every registration after
 * it in the module.
 */
export function findBalancedEnd(code: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < code.length; i++) {
    const ch = code[i]
    if (ch === '"' || ch === '\'' || ch === '`') {
      for (i++; i < code.length; i++) {
        if (code[i] === '\\')
          i++
        else if (code[i] === ch)
          break
      }
    }
    else if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i + 2)
      if (end === -1)
        return -1
      i = end
    }
    else if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      if (end === -1)
        return -1
      i = end + 1
    }
    else if (ch === '(') {
      depth++
    }
    else if (ch === ')') {
      depth--
      if (depth === 0)
        return i
    }
  }
  return -1
}

export interface WorkletRegistrationCall {
  id: string
  /** Verbatim call text, `registerWorklet[Internal]("type", "id", fn);`. */
  call: string
}

const CALL_RE = /registerWorklet(?:Internal)?\(/g
const HEAD_RE = /^registerWorklet(?:Internal)?\("[^"]+",\s*"([^"]+)",\s*/

/**
 * Extract worklet registration calls from SWC output text, verbatim.
 * Anchored on the registration call (`registerWorklet(`/`registerWorkletInternal(`)
 * with balanced-paren scanning (string/comment aware) — never on the
 * `'function'` keyword. Slicing starts AT the marker, so prefixes like
 * `__workletRuntimeLoaded && ` and the `loadWorkletRuntime` const are
 * naturally dropped (same technique as vue's `extractRegistrations`); the
 * MT entry bundles the official worklet-runtime IIFE first, so the guard
 * is dead weight. Returns every well-formed call found; malformed input
 * is skipped (callers that expect an exact count must fail loud — see
 * `extractSingleWorkletCall` below).
 */
export function extractWorkletCalls(code: string): WorkletRegistrationCall[] {
  const out: WorkletRegistrationCall[] = []
  // Module-level /g regex is stateful — reset per call (reentrancy).
  CALL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CALL_RE.exec(code))) {
    // The regex ends at '(' — back up to the paren itself.
    const open = m.index + m[0].length - 1
    const close = findBalancedEnd(code, open)
    if (close === -1)
      break
    let end = close + 1
    if (end < code.length && code[end] === ';')
      end++
    // `close` is the balanced paren — no backtracking-prone full-call
    // regex needed. The id comes from the head; the call goes out verbatim.
    // (id stays structured — not plain strings — because the LEPUS caller
    // dedupes by it; do not "simplify" this back to string[].)
    const head = code.slice(m.index, close)
    const id = head.match(HEAD_RE)?.[1]
    if (id)
      out.push({ id, call: code.slice(m.index, end) })
    CALL_RE.lastIndex = end
  }
  return out
}

/**
 * Single-call variant: returns the verbatim call when the input holds
 * exactly one well-formed registration, else null so the caller fails
 * loud instead of emitting a partial bundle.
 */
export function extractSingleWorkletCall(code: string): string | null {
  const calls = extractWorkletCalls(code)
  if (calls.length !== 1)
    return null
  return calls[0].call
}
