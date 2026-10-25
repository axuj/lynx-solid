import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import type { JSXDOMExpressionsConfig } from "./config";

export interface JSXDOMExpressionsPass {
  opts: Partial<JSXDOMExpressionsConfig>;
  skip?: boolean;
}

export interface TemplateRecord {
  id: t.Identifier;
  template: string | t.Expression | t.ArrayExpression;
  templateWithClosingTags?: string | t.Expression | t.ArrayExpression;
  isImportNode?: boolean;
  isWrapped?: boolean;
  /** lynx: numeric template id (INSTANTIATE frames / registerTemplate) */
  lynxId?: number;
  /** lynx: skeleton tree the createCode is generated from */
  skeleton?: SkeletonNode;
  /** lynx: generated MT-side create(P,H,S) function source */
  createCode?: string;
  /** lynx: total P.create calls (MT id run length) */
  nodeCount?: number;
  /** lynx: DFS offsets of the elements referenced by dynamic bindings */
  anchors?: SkeletonAnchor[];
  /** lynx: main-thread worklets in this template (registerWorklet) */
  worklets?: WorkletRecord[];
}

/** lynx: an element/text node in the static skeleton (DFS pre-order). */
export interface SkeletonNode {
  kind: "element" | "text" | "dyn";
  tag?: string;
  /** static attribute values in template order (class/id/other via P.cls/P.id/P.prop) — never style */
  statics?: [string, string | number | boolean | null][];
  /** static style in its own slot: string = user kebab CSS, object = camelCase engine object form */
  styleStatic?: string | Record<string, string | number>;
  text?: string;
  children: SkeletonNode[];
  /** DFS index (P.create call order) — assigned during createCode gen */
  offset?: number;
}

/** lynx: an element referenced by dynamic bindings (anchor = firstId + offset). */
export interface SkeletonAnchor {
  /** index into the instance refs array (allocation order of the walk chain) */
  index: number;
  /** DFS offset of the owning element within the template */
  offset: number;
  /** lynx: owning skeleton node (offset assigned during createCode gen) */
  node?: SkeletonNode;
}

export interface ProgramScopeData {
  imports?: Map<string, t.Identifier>;
  templates?: TemplateRecord[];
  /** lynx: main-thread worklets (id → parameterized source) */
  worklets?: WorkletRecord[];
  /**
   * lynx: next BG-only slot-marker index. Program-scoped (one counter per
   * file — deterministic under the rspack worker pool, unlike the old
   * cross-file globalTemplateId): marker slots only need uniqueness per
   * template instance, and each template instance owns a disjoint id run,
   * so a file-wide monotonic counter is a safe superset.
   */
  markerNext?: number;
}

export type BabelFileWithMetadata = {
  ast: t.File;
  metadata: {
    config?: JSXDOMExpressionsConfig;
    /** lynx: extracted skeletons for the MT bundle (registerSkeleton) */
    lynxTemplates?: LynxExtractedTemplate[];
    /** lynx: extracted main-thread worklets for the MT bundle */
    lynxWorklets?: WorkletRecord[];
  };
};

/** lynx: template extraction consumed by the compile pipeline. */
export interface LynxExtractedTemplate {
  id: number;
  createCode: string;
  nodeCount: number;
  anchors: { index: number, offset: number }[];
  worklets?: WorkletRecord[];
}

export type BabelHubWithMetadata = {
  file: BabelFileWithMetadata;
};

export type TemplateResult = string | string[] | t.Expression | t.ArrayExpression;
export type ResultDeclaration = t.VariableDeclarator | t.Statement | null;
export type ResultExpression = t.Expression | t.Statement;
export type ResultTemplateValue = t.Expression;
export type ResultPostDeclaration = t.VariableDeclarator;
export type ResultPostExpression = t.Statement;
export type JSXNode =
  | t.JSXElement
  | t.JSXFragment
  | t.JSXText
  | t.JSXExpressionContainer
  | t.JSXSpreadChild;

export interface TransformResult {
  template: TemplateResult;
  templateValues?: ResultTemplateValue[];
  // Narrow by construction: every producer pushes only t.variableDeclarator
  // (the `| t.Statement | null` arm of ResultDeclaration is upstream legacy,
  // never populated — kept alias untouched for upstream diff).
  declarations: t.VariableDeclarator[];
  postDeclarations?: ResultPostDeclaration[];
  exprs: ResultExpression[];
  dynamics: DynamicBinding[];
  postExprs?: ResultPostExpression[];
  decl?: t.VariableDeclaration;
  id?: t.Identifier;
  text?: boolean;
  dynamic?: boolean;
  wontEscape?: boolean;
  tagName?: string;
  isImportNode?: boolean;
  isWrapped?: boolean;
  skipTemplate?: boolean;
  templateWithClosingTags?: string;
  children?: TransformResult[];
  spreadElement?: boolean;
  groupable?: Set<string>;
  groupId?: t.Identifier;
  /** lynx: skeleton subtree rooted at this node */
  skeleton?: SkeletonNode;
  /** lynx: elements referenced by dynamic bindings (refs array order) */
  anchors?: SkeletonAnchor[];
  /** lynx: main-thread worklets extracted from this template's bindings */
  worklets?: WorkletRecord[];
}

/** lynx: a main-thread worklet — id + parameterized function source. */
export interface WorkletRecord {
  id: string;
  code: string;
}

export type TransformNodeResult = TransformResult | null | undefined;

export interface DOMTransformResult extends TransformResult {
  template: string;
  templateWithClosingTags: string;
  tagName: string;
  declarations: t.VariableDeclarator[];
  exprs: t.Statement[];
  dynamics: DynamicBinding[];
  postExprs: t.Statement[];
  toBeClosed?: Set<string>;
  /** lynx: skeleton subtree rooted at this element */
  skeleton?: SkeletonNode;
  /** lynx: elements referenced by dynamic bindings (refs array order) */
  anchors?: SkeletonAnchor[];
}

export interface DynamicBinding {
  elem: t.Expression;
  key: string;
  value: t.Expression;
  tagName?: string;
  styleProperty?: boolean;
  /** lynx: template instance root for silent-mode attachment. */
  rootId: t.Identifier;
}

export interface SetAttrOptions {
  tagName?: string;
  dynamic?: boolean;
  prevId?: t.Expression;
  styleProperty?: boolean;
}

export interface DynamicOptions {
  checkMember?: boolean;
  checkTags?: boolean;
  checkCallExpressions?: boolean;
  native?: boolean;
}

export interface TransformInfo {
  topLevel?: boolean;
  lastElement?: boolean;
  fragmentChild?: boolean;
  componentChild?: boolean;
  doNotEscape?: boolean;
  skipId?: boolean;
  toBeClosed?: Set<string>;
  parentResults?: TransformResult;
  /** lynx: template root identifier (instance object exposing refs) */
  rootId?: t.Identifier;
  /** lynx: shared anchor array for the whole template (index = refs slot) */
  anchors?: SkeletonAnchor[];
}

export type BabelPath<TNode extends t.Node = t.Node> = NodePath<TNode>;
