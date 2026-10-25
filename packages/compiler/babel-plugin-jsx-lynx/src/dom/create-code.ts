/**
 * lynx: serialize a skeleton tree into the MT-side create function source —
 * `function(P,H,S){...}`. Executed by the MT's registerSkeleton with the P
 * wrapper creating engine elements and claiming the id run
 * [firstId, firstId + nodeCount). DFS pre-order — P.create calls
 * carry the cursor that maps anchor offsets to instance ids
 * (firstId + offset). dyn nodes emit nothing (the MT never builds dynamic
 * content; dynamic subtrees arrive via INSERT ops).
 */
import type { SkeletonAnchor, SkeletonNode } from "../types";
import { noScopeAdapter } from "./scope-adapter";
import type { TemplateScopeAdapter } from "./scope-adapter";

const q = (s: string): string => JSON.stringify(s);

export interface CreateCodeResult {
  code: string;
  nodeCount: number;
  anchors: SkeletonAnchor[];
}

export function buildCreateCode(
  root: SkeletonNode,
  anchors: SkeletonAnchor[] = [],
  scope: TemplateScopeAdapter = noScopeAdapter,
  scopeId: string | null = null,
): CreateCodeResult {
  const lines: string[] = [];
  const varNames = new Map<SkeletonNode, string>();
  let counter = 0;

  const fillAnchorOffsets = (node: SkeletonNode): void => {
    if (node.offset === undefined) return;
    for (const a of anchors)
      if (a.node === node) a.offset = node.offset;
  };

  const emitNode = (node: SkeletonNode): string => {
    if (node.kind === "dyn") return "";
    const existing = varNames.get(node);
    if (existing) return existing;
    const name = `e${counter}`;
    varNames.set(node, name);
    if (node.kind === "text") {
      // Raw text run (__CreateRawText) — inherits parent text styles; a
      // nested <text> element would drop font-size/style/weight on device.
      const content = node.text !== undefined && node.text !== null ? node.text : "";
      lines.push(`var ${name}=P.rawText(${q(content)});`);
      for (const stmt of scope.elementScopeStatements(name, scopeId))
        lines.push(stmt);
      node.offset = counter;
      counter++;
      fillAnchorOffsets(node);
      return name;
    }
    lines.push(`var ${name}=P.create(${q(node.tag!)});`);
    for (const stmt of scope.elementScopeStatements(name, scopeId))
      lines.push(stmt);
    node.offset = counter;
    counter++;
    fillAnchorOffsets(node);
    const style = node.styleStatic;
    if (style !== undefined) {
      // Object form keeps camelCase keys for __SetInlineStyles(object);
      // string form is user-written kebab CSS (`style="width:100%"`).
      if (typeof style === "object")
        lines.push(`P.style(${name},${JSON.stringify(style)});`);
      else
        lines.push(`P.style(${name},${q(style)});`);
    }
    for (const [key, value] of node.statics ?? []) {
      if (key === "class") {
        if (value !== null) lines.push(`P.cls(${name},${q(String(value))});`);
      }
      else if (key === "id") {
        if (value !== null) lines.push(`P.id(${name},${q(String(value))});`);
      }
      else {
        // null statics are valueless boolean attributes (`<view scroll-y>`)
        // — the template marks the key with no value, the attribute is on.
        lines.push(`P.prop(${name},${q(key)},${value === null ? "true" : q(String(value))});`);
      }
    }
    for (const child of node.children) {
      const childName = emitNode(child);
      if (childName) lines.push(`P.append(${name},${childName});`);
    }
    return name;
  };

  emitNode(root);
  return {
    code: `function(P,H,S){\n${lines.join("\n")}\nreturn e0;}`,
    nodeCount: counter,
    anchors
  };
}