import type { CallExpression, Function, Node, Statement } from '@babel/types'
// Skeleton formatter: the generated skeleton module ships the createCode
// functions as single-line, minified-looking literals (P/H/S params, e0/e1
// locals). Re-print them through babel with semantic leading comments — node
// type, class, event, hole metadata — so the MT template structure is
// actually readable in the inspector.
import { packages } from '@babel/standalone'

const { parser, generator, types } = packages

function isPCall(call: CallExpression, method: string): boolean {
  const callee = call.callee
  return (
    types.isMemberExpression(callee)
    && types.isIdentifier(callee.object, { name: 'P' })
    && types.isIdentifier(callee.property, { name: method })
  )
}

function stringArg(call: CallExpression, index: number): string | undefined {
  const arg = call.arguments[index]
  return arg && types.isStringLiteral(arg) ? arg.value : undefined
}

function walkCalls(node: unknown, fn: (call: CallExpression) => void): void {
  if (!node || typeof node !== 'object')
    return
  const obj = node as Record<string, unknown>
  if (types.isCallExpression(node as Node))
    fn(node as CallExpression)
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    if (Array.isArray(value)) {
      for (const item of value) walkCalls(item, fn)
    }
    else if (value && typeof value === 'object') {
      walkCalls(value, fn)
    }
  }
}

function annotateStatement(stmt: Statement): void {
  const comments: string[] = []
  walkCalls(stmt, (call) => {
    if (isPCall(call, 'create')) {
      const type = stringArg(call, 0)
      if (type !== undefined)
        comments.push(`<${type}>`)
    }
    if (isPCall(call, 'text')) {
      const value = stringArg(call, 0)
      if (value !== undefined)
        comments.push(`text="${value}"`)
    }
    if (isPCall(call, 'cls')) {
      const cls = stringArg(call, 1)
      if (cls !== undefined)
        comments.push(`class="${cls}"`)
    }
    if (isPCall(call, 'style')) {
      const style = stringArg(call, 1)
      if (style !== undefined)
        comments.push(`style="${style}"`)
    }
    if (isPCall(call, 'event')) {
      const evt = stringArg(call, 1)
      if (evt !== undefined)
        comments.push(`@${evt}`)
    }
    if (isPCall(call, 'prop') || isPCall(call, 'id')) {
      const key = stringArg(call, 1)
      if (key !== undefined)
        comments.push(`${key}=`)
    }
    for (const arg of call.arguments) {
      if (types.isMemberExpression(arg) && types.isIdentifier(arg.object, { name: 'H' })) {
        const idx = arg.property
        if (types.isNumericLiteral(idx)) {
          comments.push(`H[${idx.value}] (dynamic)`)
        }
      }
    }
  })
  if (comments.length > 0)
    types.addComment(stmt, 'leading', comments.join(' '))
}

export function formatSkeletonModule(moduleCode: string): string {
  try {
    const ast = parser.parse(moduleCode, { sourceType: 'module' })
    for (const stmt of ast.program.body) {
      if (!types.isExpressionStatement(stmt))
        continue
      const call = stmt.expression
      if (!types.isCallExpression(call) || !types.isIdentifier(call.callee, { name: 'registerSkeleton' })) {
        continue
      }
      // Current shape: registerSkeleton(id, createCode) — the createCode is
      // a function expression (or arrow) over (P, H, S). Older builds
      // emitted a third holes-metadata arg; tolerate and ignore it.
      const fnArg: unknown = call.arguments[1]
      if (!types.isFunctionExpression(fnArg as Node) && !types.isArrowFunctionExpression(fnArg as Node))
        continue
      const body = (fnArg as Function).body
      if (!types.isBlockStatement(body))
        continue
      for (const bodyStmt of body.body) {
        annotateStatement(bodyStmt)
      }
    }
    const out = generator.default(ast, {}, moduleCode)
    return out.code
  }
  catch (err) {
    console.error('[artifacts] skeleton format failed:', String(err))
    return moduleCode
  }
}
