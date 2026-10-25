/**
 * Compile-pipeline protocol types (consumer side).
 *
 * Mirror of compiler/babel-plugin-jsx-lynx/src/types.ts (LynxExtractedTemplate
 * / WorkletRecord) — the fork plugin keeps its own copies so its source tree
 * stays self-contained; structural drift is caught by tests/compiler.
 */
export interface LynxExtractedTemplate {
  id: number
  createCode: string
  nodeCount: number
  anchors: { index: number, offset: number }[]
  worklets?: WorkletRecord[]
}

export interface WorkletRecord {
  id: string
  code: string
}
