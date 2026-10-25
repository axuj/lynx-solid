/**
 * Lynx-owned compiler helpers (no upstream counterpart).
 *
 * Extracted from shared/utils.ts so that file stays close to upstream
 * dom-expressions — its remaining diff is mostly deletions of SSR/DOM-only
 * paths plus a small behavior whitelist (see UPSTREAM.md). Everything here
 * is additive Lynx semantics:
 * - two-arg effect wrapping (inlineCallExpression / wrapForEffect): the Lynx
 *   effect protocol passes prev into the compute function, so callee
 *   unwrapping must not leak bare identifiers;
 * - stateful form attributes (getAttributeNamed /
 *   transformSpecialCaseAttributes / isDOMWithState / isStatefulDOMProperty /
 *   isLockedDOMProperty / addAttribute): value/checked rewrite to prop:*
 *   for Lynx stateful tags.
 */
import * as t from "@babel/types";
import { DOMWithState } from "@dom-expressions/runtime/src/constants";
import type { NodePath } from "@babel/traverse";
import type { JSXAttributePath, JSXElementPath } from "./shared/utils";

export function inlineCallExpression(node: t.Expression): t.Expression {
  return t.isCallExpression(node) &&
    !node.arguments.length &&
    !t.isCallExpression(node.callee) &&
    !t.isMemberExpression(node.callee)
    ? (node.callee as t.Expression)
    : t.arrowFunctionExpression([], node);
}

// Like inlineCallExpression, but only unwraps IIFEs — never a bare identifier
// call. Used for the first argument of a two-arg effect, where the reactive
// system passes the previous value into the compute function and a bare
// identifier callee would leak that prev into user-authored accessors.
export function wrapForEffect(node: t.Expression): t.Expression {
  return t.isCallExpression(node) &&
    !node.arguments.length &&
    (t.isArrowFunctionExpression(node.callee) || t.isFunctionExpression(node.callee))
    ? node.callee
    : t.arrowFunctionExpression([], node);
}

export function getAttributeNamed(
  path: JSXElementPath,
  name: string
): JSXAttributePath | undefined {
  return path
    .get("openingElement")
    .get("attributes")
    .find((attr): attr is JSXAttributePath => {
      if (attr.isJSXAttribute()) {
        const key = t.isJSXNamespacedName(attr.node.name)
          ? `${attr.node.name.namespace.name}:${attr.node.name.name.name}`
          : attr.node.name.name;
        return key === name;
      }
      return false;
    });
}

function renameAttribute(attr: NodePath<t.JSXAttribute>, name: string): void {
  const original = attr.node.name;
  const [ns, propName] = name.split(":");
  if (propName) {
    attr
      .get("name")
      .replaceWith(
        t.inherits(t.jsxNamespacedName(t.jsxIdentifier(ns), t.jsxIdentifier(propName)), original)
      );
  } else {
    attr.get("name").replaceWith(t.inherits(t.jsxIdentifier(name), original));
  }
}

export function transformSpecialCaseAttributes(
  path: JSXElementPath,
  tagName: string,
  isSSR: boolean
): void {
  tagName = tagName.toUpperCase();
  const transforms: { propName: string; attr: NodePath<t.JSXAttribute> }[] = [];

  let hasOrHadAttribute: Record<string, boolean> = {};

  for (const propName in DOMWithState[tagName]) {
    const attr = getAttributeNamed(path, propName);
    if (attr) {
      hasOrHadAttribute[propName] = true;
      transforms.push({ propName, attr: attr as NodePath<t.JSXAttribute> });
    }
  }

  for (const { propName, attr } of transforms) {
    const value =
      attr.node.value == null
        ? t.booleanLiteral(true)
        : t.cloneNode(
            t.isJSXExpressionContainer(attr.node.value)
              ? attr.node.value.expression
              : attr.node.value
          );

    const isDefault =
      propName.includes("default") ||
      !hasOrHadAttribute["default" + propName[0].toUpperCase() + propName.slice(1)];

    const defaultAttrName = propName.replace("default", "").toLowerCase();

    const isLiteral =
      t.isStringLiteral(value) ||
      t.isNumericLiteral(value) ||
      t.isBooleanLiteral(value) ||
      t.isNullLiteral(value);

    if (
      isDefault &&
      tagName === "TEXTAREA" &&
      defaultAttrName === "value" &&
      !t.isNullLiteral(value) &&
      // Only fold into children when SSR (HTML output needs the text content)
      // or when the value is a static literal (template-inlined HTML attribute
      // on parse). For dynamic DOM, prop:* survives the textarea "dirty" flag
      // and preserves any user-supplied children.
      (isSSR || isLiteral)
    ) {
      let child;
      if (t.isStringLiteral(value)) {
        child = t.jsxText(value.value);
        // filterChildren reads child.extra.raw for JSXText nodes
        child.extra = { raw: value.value, rawValue: value.value };
      } else {
        child = t.jsxExpressionContainer(value);
      }
      path.node.children = [child];
      attr.remove();
    } else if (isDefault && (isLiteral || isSSR)) {
      // should inline
      if (propName !== defaultAttrName) {
        renameAttribute(attr, defaultAttrName);
      }
    } else {
      renameAttribute(attr, "prop:" + propName);
    }
  }
}

export function isDOMWithState(tagName: string | undefined, propName: string): number | undefined {
  if (!tagName) return undefined;
  tagName = tagName.toUpperCase();

  if (propName.includes("prop:")) {
    propName = propName.replace("prop:", "");
  }

  return DOMWithState[tagName]?.[propName];
}

export function isStatefulDOMProperty(tagName: string | undefined, propName: string): boolean {
  return isDOMWithState(tagName, propName) === 1;
}

export function isLockedDOMProperty(tagName: string | undefined, propName: string): boolean {
  return !!isDOMWithState(tagName, propName);
}

export function addAttribute(
  path: JSXElementPath,
  name: t.JSXIdentifier,
  value: t.JSXAttribute["value"]
): void {
  path.get("openingElement").pushContainer("attributes", t.jsxAttribute(name, value));
}
