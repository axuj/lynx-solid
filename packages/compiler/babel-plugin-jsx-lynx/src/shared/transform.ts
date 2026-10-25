import * as t from "@babel/types";
import { transformElement as transformElementDOM } from "../dom/element";
import { createTemplate as createTemplateDOM } from "../dom/template";
import {
  getTagName,
  isComponent,
  isDynamic,
  trimWhitespace,
  transformCondition,
  getStaticExpression,
  escapeHTML,
  getConfig
} from "./utils";
import { transformSpecialCaseAttributes } from "../lynx-utils";
import { DOMWithState } from "@dom-expressions/runtime/src/constants";
import transformComponent from "./component";
import transformFragmentChildren from "./fragment";
import type { NodePath } from "@babel/traverse";
import type { JSXDOMExpressionsConfig } from "../config";
import type {
  BabelPath,
  JSXDOMExpressionsPass,
  JSXNode,
  TransformInfo,
  TransformNodeResult,
  TransformResult
} from "../types";

type FunctionParentScope = ReturnType<NodePath["scope"]["getFunctionParent"]>;
type TransformConditionStatements = [t.VariableDeclaration, t.ArrowFunctionExpression];

function isTransformConditionStatements(
  expr: t.Expression | TransformConditionStatements
): expr is TransformConditionStatements {
  return Array.isArray(expr);
}

export function transformJSX(
  path: NodePath<t.JSXElement | t.JSXFragment>,
  state: JSXDOMExpressionsPass
) {
  if (state.skip) return;

  // Lynx owns one native <page>. Rewrite every source tag `page` → Page
  // component so createElement('page') never
  // runs. Covers nested tags too — transformNode does not re-enter transformJSX.
  if (t.isJSXElement(path.node)) {
    const renamePage = (p: NodePath<t.JSXElement>) => {
      const opening = p.node.openingElement.name;
      if (!t.isJSXIdentifier(opening) || opening.name !== "page") return;
      // Outermost: a <page> inside another native element can never be the
      // root — fail the build with a compile error.
      const parent = p.parentPath;
      if (
        parent &&
        parent.isJSXElement() &&
        !isComponent(getTagName(parent.node)) &&
        getTagName(parent.node) !== "page"
      ) {
        throw p.buildCodeFrameError(
          "[lynx-solid] <page> must be the outermost element of the screen; " +
            "it cannot be nested inside another element."
        );
      }
      opening.name = "Page";
      const closing = p.node.closingElement;
      if (closing && t.isJSXIdentifier(closing.name)) {
        closing.name.name = "Page";
      }
    };
    renamePage(path as NodePath<t.JSXElement>);
    path.traverse({ JSXElement: renamePage });
  }

  const config = getConfig(path);

  const replace = transformThis(path);

  // Pre-pass: normalize stateful DOM attributes (value/defaultValue/checked/etc)
  // BEFORE transformNode runs so the parent's detectExpressions sees the
  // resulting `prop:*` attributes and reserves an element id when needed.
  const visit = (p: NodePath<t.JSXElement>) => {
    const tagName = getTagName(p.node);
    if (isComponent(tagName)) return;
    if (!DOMWithState[tagName.toUpperCase()]) return;
    transformSpecialCaseAttributes(p, tagName, false);
  };
  if (t.isJSXElement(path.node)) visit(path as NodePath<t.JSXElement>);
  path.traverse({ JSXElement: visit });

  const result = transformNode(
    path,
    t.isJSXFragment(path.node)
      ? {}
      : {
          topLevel: true,
          lastElement: true
        }
  );

  if (!result) return;

  path.replaceWith(
    replace(createTemplateDOM(path, result as TransformResult, false) as t.Expression)
  );

  path.traverse({
    enter(path: NodePath) {
      if (
        path.node.leadingComments &&
        path.node.leadingComments[0] &&
        path.node.leadingComments[0].value.trim() === config.staticMarker
      ) {
        path.node.leadingComments.shift();
      }
    }
  });
}

function getTargetFunctionParent(path: NodePath, parent: FunctionParentScope): FunctionParentScope {
  let current = path.scope.getFunctionParent();
  if (!current) return current;
  while (current !== parent && current.path.isArrowFunctionExpression()) {
    current = current.path.parentPath.scope.getFunctionParent();
    if (!current) return current;
  }
  return current;
}

export function transformThis(path: NodePath): (node: t.Expression) => t.Expression {
  const parent = path.scope.getFunctionParent();
  let thisId: t.Identifier | undefined, inserted: boolean | undefined;
  path.traverse({
    ThisExpression(path: NodePath<t.ThisExpression>) {
      const current = getTargetFunctionParent(path, parent);
      if (current === parent) {
        thisId || (thisId = path.scope.generateUidIdentifier("self$"));
        path.replaceWith(thisId);
      }
    },
    JSXElement(path: NodePath<t.JSXElement>) {
      let source = path.get("openingElement").get("name");
      while (source.isJSXMemberExpression()) {
        source = source.get("object");
      }
      if (source.isJSXIdentifier() && source.node.name === "this") {
        const current = getTargetFunctionParent(path, parent);
        if (current === parent) {
          thisId || (thisId = path.scope.generateUidIdentifier("self$"));
          source.replaceWith(t.jsxIdentifier(thisId!.name));

          if (path.node.closingElement) {
            path.node.closingElement.name = path.node.openingElement.name;
          }
        }
      }
    }
  });
  if (thisId && parent && parent.block.type === "ClassMethod") {
    path
      .getStatementParent()
      ?.insertBefore(
        t.variableDeclaration("const", [t.variableDeclarator(thisId, t.thisExpression())])
      );
    inserted = true;
  }
  return (node: t.Expression) => {
    if (thisId && !inserted) {
      if (!parent || parent.block.type === "ClassMethod") {
        const decl = t.variableDeclaration("const", [
          t.variableDeclarator(thisId, t.thisExpression())
        ]);
        if (parent) {
          const stmt = path.getStatementParent();
          stmt?.insertBefore(decl);
        } else {
          return t.callExpression(
            t.arrowFunctionExpression([], t.blockStatement([decl, t.returnStatement(node)])),
            []
          );
        }
      } else {
        parent.push({
          id: thisId,
          init: t.thisExpression(),
          kind: "const"
        });
      }
    }
    return node;
  };
}

export function transformNode(
  path: BabelPath<JSXNode>,
  info: TransformInfo = {}
): TransformNodeResult {
  const config = getConfig(path);
  const node = path.node;
  let staticValue: string | number | false | undefined;
  if (t.isJSXElement(node)) {
    return transformElement(config, path as BabelPath<t.JSXElement>, info);
  } else if (t.isJSXFragment(node)) {
    let results: TransformResult = { template: "", declarations: [], exprs: [], dynamics: [] };
    // <><div /><Component /></>
    transformFragmentChildren(path.get("children"), results, config);
    return results;
  } else if (
    t.isJSXText(node) ||
    (staticValue = getStaticExpression(path as BabelPath<t.JSXExpressionContainer>)) !== false
  ) {
    const text: string =
      staticValue !== undefined
        ? info.doNotEscape
          ? String(staticValue)
          : (escapeHTML(String(staticValue)) as string)
        : trimWhitespace((node.extra?.raw as string | undefined) ?? "");
    if (!(text as string).length) return null;
    const results: TransformResult = {
      template: text,
      declarations: [],
      exprs: [],
      dynamics: [],
      postExprs: [],
      text: true,
      skeleton: { kind: "text", text, children: [] }
    };
    if (!info.skipId) results.id = path.scope.generateUidIdentifier("el$");
    return results;
  } else if (t.isJSXExpressionContainer(node)) {
    if (t.isJSXEmptyExpression(node.expression)) return null;
    if (
      !isDynamic(path.get("expression"), {
        checkMember: true,
        checkTags: !!info.componentChild,
        native: !info.componentChild
      })
    ) {
      return { exprs: [node.expression], template: "", declarations: [], dynamics: [] };
    }
    const expr: t.Expression | TransformConditionStatements =
      config.wrapConditionals &&
      (t.isLogicalExpression(node.expression) || t.isConditionalExpression(node.expression))
        ? transformCondition(path.get("expression"), info.componentChild || info.fragmentChild)
        : !info.componentChild &&
              t.isCallExpression(node.expression) &&
              !t.isCallExpression(node.expression.callee) &&
              !t.isMemberExpression(node.expression.callee) &&
              node.expression.arguments.length === 0
          ? (node.expression.callee as t.Expression)
          : t.arrowFunctionExpression([], node.expression);
    return {
      exprs: isTransformConditionStatements(expr)
        ? [
            t.callExpression(
              t.arrowFunctionExpression(
                [],
                t.blockStatement([expr[0], t.returnStatement(expr[1])])
              ),
              []
            )
          ]
        : [expr],
      template: "",
      declarations: [],
      dynamics: [],
      dynamic: true
    };
  } else if (t.isJSXSpreadChild(node)) {
    if (
      !isDynamic(path.get("expression"), {
        checkMember: true,
        native: !info.componentChild
      })
    )
      return { exprs: [node.expression], template: "", declarations: [], dynamics: [] };
    const expr = t.arrowFunctionExpression([], node.expression);
    return {
      exprs: [expr],
      template: "",
      declarations: [],
      dynamics: [],
      dynamic: true
    };
  }
}

export function transformElement(
  config: JSXDOMExpressionsConfig,
  path: BabelPath<t.JSXElement>,
  info: TransformInfo = {}
): TransformResult {
  // Safety net: any `page` that slipped past transformJSX's tree rename.
  const opening = path.node.openingElement.name;
  if (t.isJSXIdentifier(opening) && opening.name === "page") {
    opening.name = "Page";
    const closing = path.node.closingElement;
    if (closing && t.isJSXIdentifier(closing.name)) {
      closing.name.name = "Page";
    }
  }
  const tagName = getTagName(path.node);
  if (isComponent(tagName)) return transformComponent(path);
  return transformElementDOM(path, info);
}
