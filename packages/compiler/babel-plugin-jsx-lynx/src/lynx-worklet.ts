/**
 * lynx-worklet — minimal worklet helpers for the fork compiler.
 *
 * Worklet body codegen, free-variable extraction, `with {runtime:"shared"}`
 * handling and worklet ids all come from the official Rust SWC transform
 * (`@lynx-js/react/transform`, applied in a later pass). This module keeps
 * only what SWC cannot know:
 *  - Element/UI worklet directive detection (for compile-time errors)
 *  - handler function path resolution (for the same checks)
 *  - `fnv1a` (reused by template.ts for skeleton template ids)
 */
import * as babelTypes from '@babel/types'

const t = babelTypes

type BPath<TNode extends babelTypes.Node = babelTypes.Node>
  = import('@babel/traverse').NodePath<TNode>

// ---------------------------------------------------------------------------
// Content hash (skeleton template ids — see dom/template.ts)
// ---------------------------------------------------------------------------

/**
 * FNV-1a content hash — stable across separate compilations; a running
 * counter diverges. (`Math.imul` keeps true 32-bit semantics — plain `*`
 * rounds past 2^53 and biases the distribution.) Output stays positive
 * int32: the op protocol carries template ids as int32.
 */
export function fnv1a(str: string, seed: number = 0x811C9DC5): number {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// Directive detection & handler resolution
// ---------------------------------------------------------------------------

/**
 * Whether a function node carries an Element worklet directive: the official
 * `'main thread'` or its `'main-thread'` alias (same `WorkletType::Element`,
 * registered as `"main-thread"` upstream).
 */
export function hasMainThreadDirective(fnPath: BPath): boolean {
  return workletDirectiveKind(fnPath) === 'element'
}

/**
 * Whether a function node carries the UI worklet directive (`'use worklet'`,
 * `WorkletType::UI` — runs on the UI thread, NOT the main thread, so it is
 * never valid where an Element worklet is required; callers must reject it
 * with a dedicated error instead of falling through to BG dispatch).
 */
export function hasUIWorkletDirective(fnPath: BPath): boolean {
  return workletDirectiveKind(fnPath) === 'ui'
}

function workletDirectiveKind(fnPath: BPath): 'element' | 'ui' | null {
  const node = fnPath.node
  if (!t.isFunction(node) || !t.isBlockStatement(node.body))
    return null
  const values: string[] = [
    ...(node.body.directives?.map(d => d.value.value) ?? []),
  ]
  for (const stmt of node.body.body) {
    if (t.isExpressionStatement(stmt) && t.isStringLiteral(stmt.expression))
      values.push(stmt.expression.value)
  }
  // Element first: a pathological double-marked function keeps Element
  // semantics (the only kind this pipeline can run).
  if (values.some(v => v === 'main thread' || v === 'main-thread'))
    return 'element'
  if (values.includes('use worklet'))
    return 'ui'
  return null
}

/**
 * Reject bare-function captures inside an Element worklet at compile time.
 *
 * SWC captures free variables into `_c` by reference; a plain same-module
 * function evaporates over JSON and the MT body calls `undefined` with zero
 * errors. Only same-module function bindings are judged here — imports are
 * skipped (shared ones never enter `_c`; foreign ones are named by the
 * runtime crossing guard), as are params and globals. Nested or referenced
 * worklets are queued for their own check (their captures travel in their
 * own `_c`). Class instances and aliased functions are likewise
 * runtime-guard territory.
 */
export function assertCrossableWorkletCaptures(fnPath: BPath): void {
  const seen = new Set<object>()
  const queue: BPath[] = [fnPath]
  let head = queue.shift()
  while (head) {
    checkWorkletCaptures(head, queue, seen)
    head = queue.shift()
  }
}

function checkWorkletCaptures(fnPath: BPath, queue: BPath[], seen: Set<object>): void {
  const node = fnPath.node
  if (!t.isFunction(node) || !t.isBlockStatement(node.body) || seen.has(node))
    return
  seen.add(node)
  let fnName = 'anonymous'
  if ((t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) && node.id)
    fnName = node.id.name
  else if (fnPath.parentPath.isVariableDeclarator() && t.isIdentifier(fnPath.parentPath.node.id))
    fnName = fnPath.parentPath.node.id.name
  fnPath.traverse({
    Function(path) {
      if (path === fnPath)
        return
      // Nested worklets get their own check (their captures land in their
      // own `_c`); plain nested functions are walked through — their free
      // vars resolve through the same scopes.
      if (hasMainThreadDirective(path) || hasUIWorkletDirective(path)) {
        queue.push(path)
        path.skip()
      }
    },
    Identifier(path) {
      if (!path.isReferencedIdentifier())
        return
      const name = path.node.name
      const binding = path.scope.getBinding(name)
      if (!binding || isWithinScope(fnPath.scope, binding.scope))
        return
      if (
        binding.path.isImportSpecifier()
        || binding.path.isImportDefaultSpecifier()
        || binding.path.isImportNamespaceSpecifier()
      ) {
        return
      }
      const target = bareFunctionTarget(binding.path)
      if (!target)
        return
      if (hasMainThreadDirective(target) || hasUIWorkletDirective(target)) {
        // Referenced (not lexically nested) worklet: its captures travel in
        // its own `_c`, so queue it for its own check instead of throwing
        // here. The visited set terminates mutual recursion.
        queue.push(target)
        return
      }
      throw path.buildCodeFrameError(
        `Worklet '${fnName}' captures plain function '${name}', which cannot `
        + `cross to the main thread (functions are dropped by JSON serialization `
        + `— the handler would call undefined with zero errors). Mark '${name}' `
        + `with the 'main thread' directive, move it into a \`with { runtime: `
        + `'shared' }\` module, or inline it.`,
      )
    },
  })
}

/** Unwrap a binding to the function value it holds, if any. */
function bareFunctionTarget(bpath: BPath): BPath | null {
  if (bpath.isFunction())
    return bpath
  if (bpath.isVariableDeclarator()) {
    const init = bpath.get('init')
    if (!Array.isArray(init) && init.isFunction())
      return init
  }
  return null
}

function isWithinScope(root: object, scope: { parent?: object | null } | null | undefined): boolean {
  let current = scope
  while (current) {
    if (current === root)
      return true
    current = current.parent ?? null
  }
  return false
}

/**
 * Resolve the function path of a `main-thread:bind*` handler attribute:
 * an inline function expression, or the function a referenced identifier
 * resolves to. Returns null when unresolvable.
 */
export function getMainThreadHandlerPath(
  attribute: BPath<babelTypes.JSXAttribute | babelTypes.JSXSpreadAttribute>,
  path: BPath,
): BPath | null {
  if (!t.isJSXAttribute(attribute.node))
    return null
  const exprPath = attribute.get('value').get('expression')
  const node = exprPath.node
  if (t.isFunction(node))
    return exprPath
  if (!t.isIdentifier(node))
    return null
  const binding = path.scope.getBinding(node.name)
  if (!binding)
    return null
  if (t.isFunction(binding.path.node))
    return binding.path
  if (t.isVariableDeclarator(binding.path.node)) {
    const init = binding.path.get('init')
    if (init && t.isFunction(init.node))
      return init
  }
  return null
}
