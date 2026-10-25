import * as babelTypes from "@babel/types";
import {
  assertCrossableWorkletCaptures,
  getMainThreadHandlerPath,
  hasMainThreadDirective,
  hasUIWorkletDirective,
} from "../lynx-worklet";

const t = babelTypes;


import { generate } from "@babel/generator";

import {
  ChildProperties,
  SVGElements,
  MathMLElements,
  Namespaces,
  VoidElements
} from "@dom-expressions/runtime/src/constants";
import {
  evaluateAndInline,
  getTagName,
  isDynamic,
  isComponent,
  registerImportMethod,
  filterChildren,
  checkLength,
  getStaticExpression,
  reservedNameSpaces,
  wrappedByText,
  getConfig,
  escapeHTML,
  convertJSXIdentifier,
  trimWhitespace,
  hasStaticMarker
} from "../shared/utils";
import {
  getAttributeNamed,
  inlineCallExpression,
  isLockedDOMProperty
} from "../lynx-utils";
import { transformNode } from "../shared/transform";
import { InlineElements, BlockElements } from "./constants";
import type {
  BabelPath,
  DOMTransformResult,
  JSXNode,
  ProgramScopeData,
  SkeletonAnchor,
  SkeletonNode,
  TransformInfo,
  TransformResult
} from "../types";

type JSXAttributePath = BabelPath<babelTypes.JSXAttribute | babelTypes.JSXSpreadAttribute>;
type JSXAttributeOnlyPath = BabelPath<babelTypes.JSXAttribute>;
type JSXChildPath = BabelPath<JSXNode>;
type DOMTransformInfo = TransformInfo & ReturnType<typeof getConfig>;
type DOMSetAttrOptions = {
  dynamic?: boolean;
  prevId?: babelTypes.Expression;
  tagName?: string;
};
type SpreadOptions = {
  elem: babelTypes.Expression;
  hasChildren: boolean;
};
type HubWithFileMetadata = {
  file?: {
    opts?: {
      filename?: string;
    };
  };
};

function isNamedAttribute(
  attribute: JSXAttributePath,
  name: string
): attribute is JSXAttributeOnlyPath {
  return (
    t.isJSXAttribute(attribute.node) &&
    t.isJSXIdentifier(attribute.node.name) &&
    attribute.node.name.name === name
  );
}

/**
 * Whether an element participates in the element-claim contract: `a[href]`
 * and `form[action]` (attribute present in any form, or a spread that may
 * carry it). Compiled output claims these at creation via `claimElement` so
 * consumers (e.g. a router's link-state layer) can track them without
 * per-element components or observers. Dormant at runtime until a consumer
 * registers.
 */
function isClaimTarget(node: babelTypes.JSXElement): boolean {
  const tagName = getTagName(node);
  const attrName = tagName === "a" ? "href" : tagName === "form" ? "action" : undefined;
  if (!attrName) return false;
  return node.openingElement.attributes.some(
    attr =>
      t.isJSXSpreadAttribute(attr) ||
      (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === attrName)
  );
}

const alwaysClose = [
  "title",
  "style",
  "a",
  "strong",
  "small",
  "b",
  "u",
  "i",
  "em",
  "s",
  "code",
  "object",
  "table",
  "button",
  "textarea",
  "select",
  "iframe",
  "script",
  "noscript",
  "template",
  "fieldset"
];

/**
 * lynx: fold a single static JSXText child into the parent's `text`
 * attribute — shape alone decides, no tag check. Bare static text is
 * non-standard
 * Lynx usage (docs say wrap in `<text>`); folding normalizes it onto the
 * parent instead of scaffolding a special child path for it. Dynamic or
 * multi-child cases keep the nested spelling.
 *
 * Skips when a `text` attr already exists (avoids duplicate slot);
 * empty/whitespace-only after trim is still emitted as text="" only
 * when the raw JSXText was the sole child.
 */
function foldSingleStaticTextChild(path: BabelPath<babelTypes.JSXElement>): void {
  const childPaths = filterChildren(path.get("children"));
  if (childPaths.length !== 1) return;
  const child = childPaths[0];
  let text: string;
  if (child.isJSXText()) {
    const raw = (child.node.extra?.raw as string | undefined) ?? child.node.value;
    text = trimWhitespace(raw);
  } else if (child.isJSXExpressionContainer()) {
    // children="hello" / children={const} promotion lands as a static
    // expression container, not JSXText — same fold shape.
    const staticVal = getStaticExpression(child);
    if (staticVal === false) return;
    text = trimWhitespace(String(staticVal));
  } else {
    return;
  }
  const hasTextAttr = path.node.openingElement.attributes.some(
    a =>
      t.isJSXAttribute(a) &&
      t.isJSXIdentifier(a.name) &&
      a.name.name === "text"
  );
  if (hasTextAttr) return;
  path.node.children = [];
  path.node.openingElement.attributes.push(
    t.jsxAttribute(t.jsxIdentifier("text"), t.stringLiteral(text))
  );
}

/**
 * A text element whose sole child is a *dynamic* expression is promoted to the
 * `text` attribute — the same channel the static fold above produces and the
 * same shape `<text text={expr}>` already compiles to. Left as a child it routes
 * through Solid-universal's `insert(parent, accessor)`, which walks the parent's
 * children and materialises a raw-text node (CREATE_TEXT + SET_TEXT + INSERT).
 * Measured on device that path is the single most expensive item of the
 * first-screen render (~190µs per call). Only `text` elements are promoted:
 * there `text` is the payload channel, and it holds exactly one value.
 */
function foldSingleDynamicTextChild(path: BabelPath<babelTypes.JSXElement>): void {
  if (getTagName(path.node) !== "text") return;
  const childPaths = filterChildren(path.get("children"));
  if (childPaths.length !== 1) return;
  const child = childPaths[0];
  if (!child.isJSXExpressionContainer()) return;
  if (t.isJSXEmptyExpression(child.node.expression)) return;
  // Static values are the fold above's job; false === not statically known.
  if (getStaticExpression(child) !== false) return;
  const hasTextAttr = path.node.openingElement.attributes.some(
    a =>
      t.isJSXAttribute(a) &&
      t.isJSXIdentifier(a.name) &&
      (a.name.name === "text" || a.name.name === "textContent")
  );
  if (hasTextAttr) return;
  path.node.children = [];
  path.node.openingElement.attributes.push(
    t.jsxAttribute(
      t.jsxIdentifier("text"),
      t.jsxExpressionContainer(t.cloneNode(child.node.expression, true))
    )
  );
}

export function transformElement(
  path: BabelPath<babelTypes.JSXElement>,
  info: TransformInfo = {}
): DOMTransformResult {
  let tagName = getTagName(path.node);

  foldSingleStaticTextChild(path);
  foldSingleDynamicTextChild(path);

  path
    .get("openingElement")
    .get("attributes")
    .forEach((attr: JSXAttributePath) => {
      if (t.isJSXAttribute(attr.node)) evaluateAndInline(attr.node.value, attr.get("value"));
    });

  let isWrapped = false;
  let wrapperTag = "";
  if (info.topLevel) {
    /**
     * XML handling.
     *
     * 1. XML partials are wrapped into their "owner" tag <svg>/<math>
     * 2. "xmlns" attribute is also used to know if a tag needs to be wrapped. For example `<a
     *    xmlns="http://www.w3.org/2000/svg"/>` becomes `<svg><a/></svg>`
     * 3. "xmlns" attribute is not needed by the browser and removed to make templates smaller
     */
    const xmlnsAttr = getAttributeNamed(path, "xmlns");

    // svg and math tags are already wrapped
    if (tagName !== "svg" && tagName !== "math") {
      const xmlnsValue = xmlnsAttr?.node.value;
      const xmlns = babelTypes.isJSXExpressionContainer(xmlnsValue)
        ? (xmlnsValue.expression as babelTypes.StringLiteral).value
        : babelTypes.isStringLiteral(xmlnsValue)
          ? xmlnsValue.value
          : undefined;

      if (SVGElements.has(tagName) || xmlns === Namespaces.svg) {
        isWrapped = true;
        wrapperTag = "svg";
        xmlnsAttr && xmlnsAttr.remove();
      } else if (MathMLElements.has(tagName) || xmlns === Namespaces.mathml) {
        isWrapped = true;
        wrapperTag = "math";
        xmlnsAttr && xmlnsAttr.remove();
      }
    } else {
      xmlnsAttr && xmlnsAttr.remove();
    }
  }

  let config = getConfig(path),
    voidTag = VoidElements.has(tagName),
    hasCustomElement =
      tagName.indexOf("-") > -1 ||
      path
        .get("openingElement")
        .get("attributes")
        .some(
          (a: JSXAttributePath) =>
            t.isJSXAttribute(a.node) &&
            !t.isJSXNamespacedName(a.node.name) &&
            a.node.name.name === "is"
        ),
    isImportNode = hasCustomElement,
    results: DOMTransformResult = {
      template: `<${tagName}`,
      templateWithClosingTags: `<${tagName}`,
      declarations: [],
      exprs: [],
      dynamics: [],
      postExprs: [],
      isImportNode,
      isWrapped,
      tagName,
      skipTemplate: false,
      skeleton: { kind: "element", tag: tagName, children: [], statics: [] }
    };

  // lynx: the template's anchor array lives on the shared info object so
  // every nested transformChildren pushes into the same array (refs slot =
  // array position) — local concat would duplicate indices.
  info.anchors ??= [];
  results.anchors = info.anchors;

  path
    .get("openingElement")
    .get("attributes")
    .some((a: JSXAttributePath) => {
      if (
        t.isJSXAttribute(a.node) &&
        !t.isJSXNamespacedName(a.node.name) &&
        a.node.name.name === "_hk"
      ) {
        a.remove();
        let filename = "";
        try {
          filename =
            ((path.scope.getProgramParent().path.hub as HubWithFileMetadata).file?.opts
              ?.filename as string | undefined) || "";
        } catch (e) {}

        console.log(
          "\n" +
            path
              .buildCodeFrameError(
                `"_hk" attribute found in template, which could potentially cause hydration miss-matches. Usually happens when copying and pasting Solid SSRed code into JSX. Please remove the attribute from the JSX. \n\n${filename}\n`
              )
              .toString()
        );
      }
    });
  if (wrapperTag !== "") {
    results.template = `<${wrapperTag}>` + results.template;
    results.templateWithClosingTags = `<${wrapperTag}>` + results.templateWithClosingTags;
  }
  if (!info.skipId) {
    results.id = path.scope.generateUidIdentifier("el$");
  }
  // Claim contract: a[href] / form[action] elements are claimed at creation
  // so registered consumers (e.g. a router's link-state layer) see them.
  // detectExpressions forces the id chain, so claim targets always have one.
  // Emitted ahead of the attribute expressions — writes to the claimed
  // attribute recheck through the runtime's setAttribute, so order stays
  // correct either way, but "claim at creation" reads first.
  if (results.id && isClaimTarget(path.node)) {
    results.exprs.push(
      t.expressionStatement(
        t.callExpression(
          registerImportMethod(path, "claimElement", getConfig(path).moduleName),
          [results.id]
        )
      )
    );
  }
  // Template roots always allocate an id (topLevel/fragmentChild transforms
  // never set skipId), so every nested transform receives a non-null root —
  // the required `rootId` parameters below rely on this invariant.
  transformAttributes(path, results, info.rootId ?? results.id!);
  results.template += ">";
  results.templateWithClosingTags += ">";
  if (!voidTag) {
    // always close tags can still be skipped if they have no closing parents and are the last element
    const toBeClosed =
      !info.lastElement ||
      !config.omitLastClosingTag ||
      (info.toBeClosed && (!config.omitNestedClosingTags || info.toBeClosed.has(tagName)));
    if (toBeClosed) {
      results.toBeClosed = new Set(info.toBeClosed || alwaysClose);
      results.toBeClosed.add(tagName);
      if (InlineElements.includes(tagName))
        BlockElements.forEach((i: string) => results.toBeClosed!.add(i));
    } else results.toBeClosed = info.toBeClosed;
    if (tagName !== "noscript") transformChildren(path, results, config, info.rootId ?? results.id!, info.anchors);
    if (toBeClosed) results.template += `</${tagName}>`;
    results.templateWithClosingTags += `</${tagName}>`;
  }
  if (wrapperTag !== "") {
    results.template += `</${wrapperTag}>`;
    results.templateWithClosingTags += `</${wrapperTag}>`;
  }
  return results;
}

export function setAttr(
  path: BabelPath,
  elem: babelTypes.Expression,
  name: string,
  value: babelTypes.Expression,
  { dynamic, prevId, tagName }: DOMSetAttrOptions = {},
  rootId: babelTypes.Identifier
): babelTypes.Expression {
  // pull out namespace
  let parts, namespace;
  if ((parts = name.split(":")) && parts[1] && reservedNameSpaces.has(parts[0])) {
    name = parts[1];
    namespace = parts[0];
  }

  if (name === "style") {
    return t.callExpression(
      registerImportMethod(path, "style", getConfig(path).moduleName),
      prevId ? [elem, value, prevId] : [elem, value]
    );
  }

  if (name === "class") {
    return t.callExpression(
      registerImportMethod(path, "className", getConfig(path).moduleName),
      prevId ? [elem, value, prevId] : [elem, value]
    );
  }

  if (dynamic && name === "textContent") {
    // lynx: BG refs are numeric ids — text lands as the element's `text`
    // attribute via the runtime (SET_TEXT-equivalent op), never a direct
    // data assignment on a number.
    const args = rootId
      ? [rootId, elem, t.stringLiteral("text"), value]
      : [elem, t.stringLiteral("text"), value];
    return t.callExpression(
      registerImportMethod(path, "setAttribute", getConfig(path).moduleName),
      args
    );
  }

  const isChildProp = ChildProperties.has(name);
  const isLocked = isLockedDOMProperty(tagName, name);

  if (isChildProp || namespace === "prop" || isLocked) {
    // lynx: BG refs are numeric ids — child props (input value etc.) must
    // flow through the runtime setAttribute (SET_PROP op) instead of direct
    // element assignment, which throws on number refs.
    let runtimeValue = value;
    if (
      (name === "value" || name === "defaultValue") &&
      (tagName === "input" || tagName === "textarea") &&
      !t.isStringLiteral(runtimeValue) &&
      !t.isNumericLiteral(runtimeValue)
    ) {
      runtimeValue = t.logicalExpression(
        "??",
        runtimeValue,
        t.stringLiteral("")
      );
    }
    const args = rootId
      ? [rootId, elem, t.stringLiteral(name), runtimeValue]
      : [elem, t.stringLiteral(name), runtimeValue];
    return t.callExpression(
      registerImportMethod(path, "setAttribute", getConfig(path).moduleName),
      args
    );
  }

  const ns = name.indexOf(":") > -1 && Namespaces[name.split(":")[0]];
  if (ns) {
    return t.callExpression(
      registerImportMethod(path, "setAttributeNS", getConfig(path).moduleName),
      [elem, t.stringLiteral(ns), t.stringLiteral(name), value]
    );
  } else {
    // the template instance root rides along so the runtime can attach
    // silent-mode dynamic content (bind* events) to the instance it belongs to
    return t.callExpression(
      registerImportMethod(path, "setAttribute", getConfig(path).moduleName),
      [rootId, elem, t.stringLiteral(name), value]
    );
  }
}

function transformAttributes(
  path: BabelPath<babelTypes.JSXElement>,
  results: DOMTransformResult,
  rootId: babelTypes.Identifier
): void {
  let elem = results.id as babelTypes.Expression,
    children: babelTypes.JSXExpressionContainer | babelTypes.JSXText | undefined,
    spreadExpr: babelTypes.ExpressionStatement | undefined,
    attributes = path.get("openingElement").get("attributes") as JSXAttributePath[];
  const tagName = getTagName(path.node),
    hasChildren = path.node.children.length > 0,
    config = getConfig(path);

  // preprocess spreads
  if (attributes.some(attribute => t.isJSXSpreadAttribute(attribute.node))) {
    [attributes, spreadExpr] = processSpreads(path, attributes, {
      elem,
      hasChildren
    });
    path.get("openingElement").set(
      "attributes",
      attributes.map(a => a.node)
    );
  } else {
    const seenAttributes: Record<string, JSXAttributeOnlyPath> = {};
    const duplicates: JSXAttributeOnlyPath[] = [];
    path
      .get("openingElement")
      .get("attributes")
      .forEach((attr: JSXAttributePath) => {
        if (!t.isJSXAttribute(attr.node)) return;
        const key = t.isJSXNamespacedName(attr.node.name)
          ? `${attr.node.name.namespace.name}:${attr.node.name.name.name}`
          : attr.node.name.name;

        if (key !== "ref" && seenAttributes[key]) {
          duplicates.push(seenAttributes[key]);
        }
        seenAttributes[key] = attr as JSXAttributeOnlyPath;
      });
    for (const duplicate of duplicates) {
      duplicate.remove();
    }
  }

  /**
   * Inline styles
   *
   * 1. String literal `style="width:100%"` → concatenated CSS string (kebab, user-authored)
   * 2. ObjectExpression statics → plain object pushed to skeleton statics
   *    (engine __SetInlineStyles(object) accepts camelCase keys; string form does not)
   * 3. Remove properties from object when value is undefined/null
   * 4. When `value.evaluate().confident`
   *
   * Also, when `key` is computed value is also `value.evaluate().confident`
   */

  attributes = path.get("openingElement").get("attributes") as JSXAttributePath[];

  const styleAttributes = attributes.filter((a): a is JSXAttributeOnlyPath =>
    isNamedAttribute(a, "style")
  );
  if (styleAttributes.length > 0) {
    let inlinedStyle = "";

    for (let i = 0; i < styleAttributes.length; i++) {
      const attr = styleAttributes[i];

      let value = attr.node.value as
        | babelTypes.Expression
        | babelTypes.JSXExpressionContainer
        | null;
      if (t.isJSXExpressionContainer(value)) {
        value = value.expression as babelTypes.Expression;
      }

      if (t.isStringLiteral(value)) {
        inlinedStyle += `${value.value.replace(/;$/, "")};`;
        attr.remove();
      } else if (t.isObjectExpression(value)) {
        const styleObject = value;
        const properties = styleObject.properties;
        const propertiesNode = (attr.get("value") as BabelPath)
          .get("expression")
          .get("properties") as BabelPath[];
        const toRemoveProperty: babelTypes.ObjectProperty[] = [];
        // A dynamic SET_STYLE is a full replacement on the MT
        // (__SetInlineStyles): any static prop hoisted to the skeleton but
        // dropped from this object would be wiped by the first dynamic
        // update. So when the object stays dynamic, hoisted statics are
        // ALSO kept in the object (skeleton keeps first-frame styling).
        const staysDynamic = properties.some((property, i) => {
          // Spread and unhoistable shapes keep the object dynamic.
          if (!t.isObjectProperty(property)) return true;
          const confidentStatic = (v: BabelPath): boolean => {
            const r = v.evaluate();
            return r.confident && (typeof r.value === "string" || typeof r.value === "number");
          };
          if (property.computed)
            return !confidentStatic(propertiesNode[i].get("value") as BabelPath);
          if (t.isStringLiteral(property.value) || t.isNumericLiteral(property.value)) return false;
          if (
            (t.isIdentifier(property.value) && property.value.name === "undefined") ||
            t.isNullLiteral(property.value)
          ) {
            return false;
          }
          return !confidentStatic(propertiesNode[i].get("value") as BabelPath);
        });

        // Collect static entries as a plain object (not a CSS string) so the
        // skeleton can call P.style(el, obj) → __SetInlineStyles(object),
        // which accepts camelCase keys. String form only accepts kebab.
        const staticStyle: Record<string, string | number> = {};
        for (let i = 0; i < properties.length; i++) {
          const property = properties[i];

          if (!t.isObjectProperty(property)) continue;
          if (property.computed) {
            /* { [computed]: `${1+1}px` } => { [computed]: `2px` } */
            const r = (propertiesNode[i].get("value") as BabelPath).evaluate();
            if (r.confident && (typeof r.value === "string" || typeof r.value === "number")) {
              property.value = t.inherits(t.stringLiteral(`${r.value}`), property.value);
            }
            // computed cannot be inlined - maybe can be evaluated but this is pretty rare
            continue;
          }

          {
            const key = t.isIdentifier(property.key)
              ? property.key.name
              : (property.key as babelTypes.StringLiteral | babelTypes.NumericLiteral).value;
            if (t.isStringLiteral(property.value) || t.isNumericLiteral(property.value)) {
              staticStyle[key] = property.value.value;
              if (!staysDynamic) toRemoveProperty.push(property);
            } else if (
              (t.isIdentifier(property.value) && property.value.name === "undefined") ||
              t.isNullLiteral(property.value)
            ) {
              toRemoveProperty.push(property);
            } else {
              const r = (propertiesNode[i].get("value") as BabelPath).evaluate();
              if (r.confident && (typeof r.value === "string" || typeof r.value === "number")) {
                staticStyle[key] = r.value;
                if (!staysDynamic) toRemoveProperty.push(property);
              }
            }
          }
        }
        for (const remove of toRemoveProperty) {
          styleObject.properties.splice(styleObject.properties.indexOf(remove), 1);
        }

        // Hoist static style object into the skeleton (first-frame styling).
        // Fully static objects leave no residual attribute; mixed ones keep
        // the ObjectExpression for the dynamic style() effect path.
        if (Object.keys(staticStyle).length > 0 && results.skeleton) {
          results.skeleton.styleStatic = staticStyle;
        }
        if (!staysDynamic || styleObject.properties.length === 0) {
          attr.remove();
        }
      }
    }

    if (inlinedStyle !== "") {
      const styleAttribute = t.jsxAttribute(
        t.jsxIdentifier("style"),
        t.stringLiteral(inlinedStyle.replace(/;$/, ""))
      );
      path.get("openingElement").node.attributes.push(styleAttribute);
    }
  }



  // preprocess leading static classes in fixed-shape class arrays
  attributes = path.get("openingElement").get("attributes") as JSXAttributePath[];
  const classArrayAttribute = attributes.find(
    (a): a is JSXAttributeOnlyPath =>
      isNamedAttribute(a, "class") &&
      t.isJSXExpressionContainer(a.node.value) &&
      t.isArrayExpression(a.node.value.expression)
  );
  if (classArrayAttribute) {
    const classArrayValue = classArrayAttribute.node.value as babelTypes.JSXExpressionContainer & {
      expression: babelTypes.ArrayExpression;
    };
    const elements = classArrayValue.expression.elements;
    let i = 0,
      staticClasses: string[] = [];
    while (t.isStringLiteral(elements[i])) {
      staticClasses.push((elements[i] as babelTypes.StringLiteral).value);
      i++;
    }
    const dynamicClassElement = elements[i] as babelTypes.ObjectExpression | null;
    const staticClassSet = new Set(
      staticClasses.flatMap(className => trimWhitespace(className).split(/\s+/).filter(Boolean))
    );
    if (
      staticClasses.length &&
      i === elements.length - 1 &&
      t.isObjectExpression(dynamicClassElement) &&
      !dynamicClassElement.properties.some(
        (p: babelTypes.ObjectMember | babelTypes.SpreadElement) =>
          t.isSpreadElement(p) ||
          p.computed ||
          (t.isStringLiteral(p.key) && (p.key.value.includes(" ") || p.key.value.includes(":"))) ||
          staticClassSet.has(
            t.isIdentifier(p.key)
              ? p.key.name
              : String((p.key as babelTypes.StringLiteral | babelTypes.NumericLiteral).value)
          )
      )
    ) {
      classArrayAttribute.node.value = t.stringLiteral(staticClasses.join(" "));
      path
        .get("openingElement")
        .node.attributes.splice(
          Number(classArrayAttribute.key) + 1,
          0,
          t.jsxAttribute(t.jsxIdentifier("class"), t.jsxExpressionContainer(dynamicClassElement))
        );
    }
  }

  // combine class properties
  attributes = path.get("openingElement").get("attributes") as JSXAttributePath[];
  const classAttributes = attributes.filter((a): a is JSXAttributeOnlyPath =>
    isNamedAttribute(a, "class")
  );
  if (classAttributes.length > 1) {
    const first = classAttributes[0].node,
      values: babelTypes.Expression[] = [],
      quasis = [t.templateElement({ raw: "" })];
    for (let i = 0; i < classAttributes.length; i++) {
      const attr = classAttributes[i].node,
        isLast = i === classAttributes.length - 1;
      if (!t.isJSXExpressionContainer(attr.value)) {
        const prev = quasis.pop();
        quasis.push(
          t.templateElement({
            raw:
              (prev ? prev.value.raw : "") +
              `${(attr.value as babelTypes.StringLiteral).value}` +
              (isLast ? "" : " ")
          })
        );
      } else {
        values.push(
          t.logicalExpression(
            "||",
            attr.value.expression as babelTypes.Expression,
            t.stringLiteral("")
          )
        );
        quasis.push(t.templateElement({ raw: isLast ? "" : " " }));
      }
      i && attributes.splice(attributes.indexOf(classAttributes[i]), 1);
    }
    if (values.length) first.value = t.jsxExpressionContainer(t.templateLiteral(quasis, values));
    else first.value = t.stringLiteral(quasis[0].value.raw);
  }
  path.get("openingElement").set(
    "attributes",
    attributes.map(a => a.node)
  );

  let needsSpacing = true;

  // scoped because of `needsSpacing`
  function inlineAttributeOnTemplate(
    key: string,
    results: DOMTransformResult,
    value: babelTypes.StringLiteral | babelTypes.NumericLiteral | babelTypes.BooleanLiteral | null
  ): void {
    results.template += `${needsSpacing ? " " : ""}${key}`;
    if (key === "style") {
      if (results.skeleton) {
        results.skeleton.styleStatic = value ? String(value.value) : undefined;
      }
    } else {
      results.skeleton?.statics?.push([
        key,
        value ? value.value : null
      ]);
    }

    if (!value) {
      needsSpacing = true;
      return;
    }

    let text = String(value.value);
    let needsQuoting = !config.omitQuotes;

    if (key === "style" || key === "class") {
      text = trimWhitespace(text);
      if (key === "style") {
        text = text.replace(/; /g, ";").replace(/: /g, ":");
      }
    }

    if (!text.length) {
      needsSpacing = true;
      results.template += ``;
      return;
    }

    for (let i = 0, len = text.length; i < len; i++) {
      let char = text[i];

      if (
        char === "'" ||
        char === '"' ||
        char === " " ||
        char === "\t" ||
        char === "\n" ||
        char === "\r" ||
        char === "`" ||
        char === "=" ||
        char === "<" ||
        char === ">"
      ) {
        needsQuoting = true;
      }
    }

    if (needsQuoting) {
      needsSpacing = !config.omitAttributeSpacing;
      results.template += `="${escapeHTML(text, true)}"`;
    } else {
      needsSpacing = true;
      results.template += `=${escapeHTML(text, true)}`;
    }
  }

  path
    .get("openingElement")
    .get("attributes")
    .forEach((attribute: JSXAttributePath) => {
      if (!t.isJSXAttribute(attribute.node)) return;
      const node = attribute.node;
      let value = node.value,
        key = t.isJSXNamespacedName(node.name)
          ? `${node.name.namespace.name}:${node.name.name.name}`
          : node.name.name,
        reservedNameSpace =
          t.isJSXNamespacedName(node.name) && reservedNameSpaces.has(node.name.namespace.name);
      if (t.isJSXExpressionContainer(value) && key.startsWith("main-thread:")) {
        // Main Thread Script attributes. `main-thread:ref` passes the ref
        // object through as-is; `main-thread:bind*` handlers must be declared
        // main thread functions (`'main thread'` directive) and are wrapped as
        // [fn, () => [["name", value], ...], workletId] so the runtime can
        // serialize a worklet context ({ _wkltId, _c }) capturing the free
        // variables (e.g. MT refs); the parameterized function body is
        // registered on the MT via registerWorklet (skeleton pipeline).
        //
        // Official ReactLynx contract (main-thread-script docs): the
        // `main-thread:` event namespace opts the event into MT dispatch AND
        // the handler body must declare itself an element worklet with the
        // `'main thread'` directive (official `'main-thread'` alias also
        // accepted) — both are required, always. `'use worklet'` (UI thread)
        // is rejected with its own error below.
        if (key !== "main-thread:ref") {
          const fnPath = getMainThreadHandlerPath(attribute, path);
          if (fnPath && hasUIWorkletDirective(fnPath)) {
            throw attribute.buildCodeFrameError(
              "'use worklet' functions run on the UI thread, not the main " +
              "thread: main-thread:bind* handlers must use the 'main thread' " +
              "(or 'main-thread') directive"
            );
          }
          if (!fnPath || !hasMainThreadDirective(fnPath)) {
            throw attribute.buildCodeFrameError(
              "main-thread:bind* handlers must be declared main thread " +
              "functions: add the 'main thread' directive as a statement " +
              "of the handler body"
            );
          }
          assertCrossableWorkletCaptures(fnPath);
          workletizeHandler(attribute, path, key, results, rootId);
          return;
        }
      }
      if (
        t.isJSXExpressionContainer(value) &&
        !key.includes(":") &&
        (key.startsWith("bind") || key.startsWith("catch"))
      ) {
        // lynx: official ReactLynx semantics — the `'main thread'` directive
        // marks a main thread function, which "can and must only run on the
        // main thread". Binding one to a regular event attribute (background
        // dispatch) is a compile error, not a silent BG fallback.
        const fnPath = getMainThreadHandlerPath(attribute, path);
        if (fnPath && hasMainThreadDirective(fnPath)) {
          throw attribute.buildCodeFrameError(
            `'main thread' functions can only run on the main thread: ` +
            `bind this handler via main-thread:${key} instead of ${key}`
          );
        }
        if (fnPath && hasUIWorkletDirective(fnPath)) {
          throw attribute.buildCodeFrameError(
            `'use worklet' functions run on the UI thread: ` +
            `they can neither run on the background (here) nor via ` +
            `main-thread:${key} (main thread) — this pipeline supports ` +
            `element worklets only`
          );
        }
      }
      if (t.isJSXExpressionContainer(value)) {
        const evaluated = attribute.get("value").get("expression").evaluate().value;
        let type;
        if (
          evaluated !== undefined &&
          ((type = typeof evaluated) === "string" || type === "number")
        ) {
          if (type === "number" && key.startsWith("prop:")) {
            value = t.jsxExpressionContainer(t.numericLiteral(evaluated));
          } else value = t.stringLiteral(String(evaluated));
        }
      }
      if (
        t.isJSXNamespacedName(node.name) &&
        reservedNameSpace &&
        !t.isJSXExpressionContainer(value)
      ) {
        node.value = value = t.jsxExpressionContainer(value || t.jsxEmptyExpression());
      }
      if (
        t.isJSXExpressionContainer(value) &&
        (reservedNameSpace ||
          !(
            t.isStringLiteral(value.expression) ||
            t.isNumericLiteral(value.expression) ||
            t.isBooleanLiteral(value.expression)
          ))
      ) {
        if (t.isJSXEmptyExpression(value.expression)) return;
        if (key === "ref") {
          // Normalize expressions for non-null and type-as
          while (
            t.isTSNonNullExpression(value.expression) ||
            t.isTSAsExpression(value.expression)
          ) {
            value.expression = value.expression.expression;
          }
          let binding,
            isConstant =
              t.isIdentifier(value.expression) &&
              (binding = path.scope.getBinding(value.expression.name)) &&
              (binding.kind === "const" || binding.kind === "module");
          if (!isConstant && t.isLVal(value.expression)) {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            results.exprs.unshift(
              t.variableDeclaration("var", [t.variableDeclarator(refIdentifier, value.expression)]),
              t.expressionStatement(
                t.conditionalExpression(
                  t.logicalExpression(
                    "||",
                    t.binaryExpression(
                      "===",
                      t.unaryExpression("typeof", refIdentifier),
                      t.stringLiteral("function")
                    ),
                    t.callExpression(
                      t.memberExpression(t.identifier("Array"), t.identifier("isArray")),
                      [refIdentifier]
                    )
                  ),
                  t.callExpression(
                    registerImportMethod(path, "ref", getConfig(path).moduleName),
                    [t.arrowFunctionExpression([], refIdentifier), elem]
                  ),
                  t.assignmentExpression("=", value.expression, elem)
                )
              )
            );
          } else if (
            isConstant ||
            t.isFunction(value.expression) ||
            t.isArrayExpression(value.expression)
          ) {
            results.exprs.unshift(
              t.expressionStatement(
                t.callExpression(
                  registerImportMethod(path, "ref", getConfig(path).moduleName),
                  [t.arrowFunctionExpression([], value.expression), elem]
                )
              )
            );
          } else {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            results.exprs.unshift(
              t.variableDeclaration("var", [t.variableDeclarator(refIdentifier, value.expression)]),
              t.expressionStatement(
                t.logicalExpression(
                  "&&",
                  t.logicalExpression(
                    "||",
                    t.binaryExpression(
                      "===",
                      t.unaryExpression("typeof", refIdentifier),
                      t.stringLiteral("function")
                    ),
                    t.callExpression(
                      t.memberExpression(t.identifier("Array"), t.identifier("isArray")),
                      [refIdentifier]
                    )
                  ),
                  t.callExpression(
                    registerImportMethod(path, "ref", getConfig(path).moduleName),
                    [t.arrowFunctionExpression([], refIdentifier), elem]
                  )
                )
              )
            );
          }
        } else if (key === "children") {
          children = value;
        } else if (
          config.effectWrapper &&
          (isDynamic(attribute.get("value").get("expression"), {
            checkMember: true
          }) ||
            ((key === "class" || key === "style") &&
              !attribute.get("value").get("expression").evaluate().confident &&
              !hasStaticMarker(value, path)))
        ) {
          // own effect
          let nextElem = elem as babelTypes.Expression;
          if (key === "textContent") {
            nextElem = attribute.scope.generateUidIdentifier("el$");
            children = t.jsxText(" ");
            children.extra = { raw: " ", rawValue: " " };
            results.declarations.push(
              t.variableDeclarator(
                nextElem as babelTypes.LVal,
                t.memberExpression(elem, t.identifier("firstChild"))
              )
            );
          }
          results.dynamics.push({
            elem: nextElem,
            key,
            value: value.expression,
            tagName,
            rootId
          });
        } else {
          results.exprs.push(
            t.expressionStatement(
              setAttr(attribute, elem, key, value.expression, {
                tagName,
              }, rootId)
            )
          );
        }
      } else {
        let staticValue: babelTypes.Expression | babelTypes.JSXAttribute["value"] = value;
        if (t.isJSXExpressionContainer(value)) {
          if (t.isJSXEmptyExpression(value.expression)) return;
          staticValue = value.expression as babelTypes.Expression;
        }

        // Native `children` is child content, not a DOM property and not an
        // HTML attribute. Promote it so the child pass can template-inline
        // statics or `insert()` dynamics — same as writing `{value}` as a child.
        // (cherry-picked from upstream bba3db6c; dynamic branch already had it.)
        if (key === "children") {
          if (!hasChildren && !VoidElements.has(tagName) && staticValue) {
            children = t.isJSXExpressionContainer(value)
              ? value
              : t.jsxExpressionContainer(staticValue as babelTypes.Expression);
          }
          return;
        }

        // boolean as `<el attr={true | false}/>`, not as `<el attr={"true" | "false"}/>`
        // `<el attr={true}/>` becomes `<el attr/>`
        // `<el attr={false}/>` becomes `<el/>`
        const booleanLiteral = t.isBooleanLiteral(staticValue) ? staticValue : undefined;
        if (booleanLiteral) {
          if (booleanLiteral.value === true) {
            results.template += `${needsSpacing ? " " : ""}${key}`;
            needsSpacing = true;
          }
          return;
        }

        // properties
        if (staticValue && ChildProperties.has(key)) {
          results.exprs.push(
            t.expressionStatement(
              setAttr(attribute, elem, key, staticValue as babelTypes.Expression, { tagName }, rootId)
            )
          );
        } else {
          inlineAttributeOnTemplate(
            key,
            results,
            staticValue as babelTypes.StringLiteral | babelTypes.NumericLiteral | null
          );
        }
      }
    });
  if (!hasChildren && children) {
    path.node.children.push(children);
    // children attr promotion lands after the head-of-transform fold —
    // re-run so a single static children value folds into `text` too.
    const attrCountBefore = path.node.openingElement.attributes.length;
    foldSingleStaticTextChild(path);
    // The attribute forEach already ran — a text attr added by this late
    // fold never reaches inlineAttributeOnTemplate; wire it into statics now.
    if (path.node.openingElement.attributes.length > attrCountBefore) {
      const lateAttr = path.node.openingElement.attributes[path.node.openingElement.attributes.length - 1];
      if (t.isJSXAttribute(lateAttr) && t.isStringLiteral(lateAttr.value))
        inlineAttributeOnTemplate("text", results, lateAttr.value);
    }
  }
  if (spreadExpr) results.exprs.push(...(Array.isArray(spreadExpr) ? spreadExpr : [spreadExpr]));
}

/**
 * lynx: emit a `main-thread:bind*` handler attribute as-is. The handler is
 * an SWC-shaped worklet object (`{ _wkltId, _c?, _jsFn? }`, produced by the
 * official transform in a later pass) — no triple, no getter, no body
 * codegen here. Directive presence is validated at the call site.
 */
function workletizeHandler(
  attribute: JSXAttributePath,
  path: BabelPath<babelTypes.JSXElement>,
  key: string,
  results: DOMTransformResult,
  rootId: babelTypes.Identifier
): void {
  const node = attribute.node;
  if (!t.isJSXAttribute(node))
    return
  const value = node.value as babelTypes.JSXExpressionContainer;
  results.exprs.push(
    t.expressionStatement(
      setAttr(attribute, results.id, key, value.expression as babelTypes.Expression, { tagName: getTagName(path.node) }, rootId)
    )
  );
}

/**
 * lynx: validate `runOnMainThread(fn)` call sites — the argument must be an
 * element worklet (a function carrying the `'main thread'` directive or its
 * `'main-thread'` alias; `'use worklet'` targets the UI thread and is
 * rejected). The call itself is left untouched: SWC shapes `fn` into
 * `{ _wkltId, _c?, _jsFn? }` in a later pass and the runtime dispatches
 * the object.
 */
export function transformRunOnMainThread(programPath: BabelPath): void {
  programPath.traverse({
    CallExpression(p: BabelPath<babelTypes.CallExpression>) {
      const callee = p.get("callee") as BabelPath;
      if (!callee.isIdentifier({ name: "runOnMainThread" })) return;
      const arg = p.get("arguments.0") as BabelPath | undefined;
      if (!arg) return;
      let fnPath: BabelPath | null = null;
      if (arg.isFunction()) {
        fnPath = arg;
      }
      else if (arg.isIdentifier()) {
        const binding = arg.scope.getBinding(arg.node.name);
        if (binding?.path.isFunction()) {
          fnPath = binding.path;
        }
        else if (binding?.path.isVariableDeclarator()) {
          const init = binding.path.get("init") as BabelPath;
          if (init && init.isFunction()) fnPath = init;
        }
      }
      if (!fnPath || !t.isFunction(fnPath.node)) return;
      if (hasUIWorkletDirective(fnPath)) {
        throw p.buildCodeFrameError(
          "runOnMainThread() calls into the main thread: "
          + "a 'use worklet' (UI thread) function cannot be its argument, "
          + "use the 'main thread' (or 'main-thread') directive",
        );
      }
      if (!hasMainThreadDirective(fnPath)) {
        throw p.buildCodeFrameError(
          "runOnMainThread() argument must be a main thread function: "
          + "add the 'main thread' directive as a statement of the function body",
        );
      }
      assertCrossableWorkletCaptures(fnPath);
    }
  });
}

// Children that compile to `insert()` calls and contribute no markup of their
// own: dynamic expression containers, components, and spread children. Mirrors
// the `!child.id && child.exprs.length` count in transformChildren.
function countDynamicSlots(children: JSXChildPath[]): number {
  let count = 0;
  for (const child of children) {
    const node = child.node;
    if (
      t.isJSXText(node) ||
      (t.isJSXExpressionContainer(node) &&
        getStaticExpression(child as BabelPath<babelTypes.JSXExpressionContainer>) !== false) ||
      (t.isJSXElement(node) && !isComponent(getTagName(node)))
    )
      continue;
    count++;
  }
  return count;
}

function findLastElement(children: JSXChildPath[]): number {
  let lastElement = -1,
    tagName;
  // Counterpart of transformChildren's per-slot markers: with two or more
  // dynamic slots under this parent (CSR only), a trailing dynamic child
  // appends a dedicated `<!>` placeholder to the template, so an earlier
  // element may not omit its closing tag — the still-open element would
  // swallow the placeholder as a child while the generated
  // firstChild/nextSibling walk expects it as a sibling.
  const perSlotMarkers = countDynamicSlots(children) > 1;
  for (let i = children.length - 1; i >= 0; i--) {
    const node = children[i].node;
    if (
      t.isJSXText(node) ||
      (t.isJSXExpressionContainer(node) &&
        getStaticExpression(children[i] as BabelPath<babelTypes.JSXExpressionContainer>) !==
          false) ||
      (t.isJSXElement(node) && (tagName = getTagName(node)) && !isComponent(tagName))
    ) {
      lastElement = i;
      break;
    }
    // This trailing dynamic slot will emit a per-slot placeholder after any
    // preceding element's markup: nothing here may omit its closing tag.
    if (perSlotMarkers) break;
  }
  return lastElement;
}

function transformChildren(
  path: BabelPath<babelTypes.JSXElement>,
  results: DOMTransformResult,
  config: DOMTransformInfo,
  rootId: babelTypes.Identifier,
  sharedAnchors?: SkeletonAnchor[]
): void {
  let tempPath = (results.id && results.id.name) || "",
    tagName = getTagName(path.node),
    childPostExprs: babelTypes.Statement[] = [];
  const filteredChildren = filterChildren(path.get("children")),
    lastElement = findLastElement(filteredChildren),
    childNodes = filteredChildren.reduce(
      (memo: TransformResult[], child: JSXChildPath, index: number) => {
        if (child.isJSXFragment()) {
          throw new Error(
            `Fragments can only be used top level in JSX. Not used under a <${tagName}>.`
          );
        }
        const transformed = transformNode(child, {
          toBeClosed: results.toBeClosed,
          lastElement: index === lastElement,
          skipId: !results.id || !detectExpressions(filteredChildren, index, config),
          rootId,
          anchors: sharedAnchors
        });
        if (!transformed) return memo;
        const i = memo.length;
        if (transformed.text && i && memo[i - 1].text) {
          memo[i - 1].template =
            `${memo[i - 1].template as string}${transformed.template as string}`;
          memo[i - 1].templateWithClosingTags +=
            transformed.templateWithClosingTags || (transformed.template as string);
        } else memo.push(transformed);
        return memo;
      },
      []
    );

  // Dynamic slots under this parent (children compiled to `insert()` calls).
  // With two or more, slots may not share an insertion marker: the marker is
  // also the runtime's ownership tag ($$SLOT), and adoption only re-tags when
  // the marker is truthy — shared or null markers let one slot's cleanup
  // destroy a node that migrated to its neighbor (solidjs/solid#2830).
  const dynamicSlots = childNodes.reduce((n, c) => (c && !c.id && c.exprs.length ? n + 1 : n), 0);

  childNodes.forEach((child, index) => {
    if (!child) return;

    results.template += child.template as string;
    results.templateWithClosingTags += child.templateWithClosingTags || (child.template as string);
    results.isImportNode = results.isImportNode || child.isImportNode;
    results.isWrapped = results.isWrapped || child.isWrapped;

    if (results.skeleton) {
      if (child.skeleton) results.skeleton.children.push(child.skeleton);
      else if (child.exprs.length) results.skeleton.children.push({ kind: "dyn", children: [] });
    }

    if (child.id) {
      // lynx: locate the anchor through the template instance refs array
      // (firstId + DFS offset) instead of walking firstChild/nextSibling.
      // sharedAnchors is the template-wide array (refs slot = position).
      const anchorIndex =
        sharedAnchors!.push({
          index: sharedAnchors!.length,
          offset: -1,
          node: child.skeleton
        }) - 1;
      const walkExpr = t.memberExpression(
        t.memberExpression(rootId, t.identifier("refs")),
        t.numericLiteral(anchorIndex),
        true
      );
      results.declarations.push(t.variableDeclarator(child.id, walkExpr));
      results.declarations.push(...child.declarations);
      results.exprs.push(...(child.exprs as babelTypes.Statement[]));
      results.dynamics.push(...child.dynamics);
      // lynx: no anchors concat — anchors live on the shared info array.
      childPostExprs.push(...(child.postExprs || []));
      results.isImportNode = results.isImportNode || child.isImportNode;
      results.isWrapped = results.isWrapped || child.isWrapped;
      tempPath = child.id.name;
    } else if (child.exprs.length) {
      let insert = registerImportMethod(path, "insert", getConfig(path).moduleName);
      const multi = checkLength(filteredChildren),
        // CSR per-slot markers: when this parent
        // hosts multiple dynamic slots, each gets its own truthy marker — the
        // immediately following sibling when it has a reference, otherwise a
        // BG-only `_$marker` (no MT node; the runtime appends a `#marker`
        // shadow node in document order). lynx: enabled — without a marker
        // the official insert degrades to replaceNode(getFirstChild(parent))
        // on re-entry of a memo-guarded slot (current flips
        // false→component), which replaced the parent's first real child
        // (route pages lost their header).
        perSlot = dynamicSlots > 1;
      // boxed by textNodes
      if (perSlot || wrappedByText(childNodes, index)) {
        let markerExpr: babelTypes.Expression | undefined;
        // Ride the immediately following sibling's reference when it exists —
        // unless the slot is boxed by text, where a placeholder is structurally
        // required to keep the surrounding template text nodes from merging.
        if (perSlot && !wrappedByText(childNodes, index)) {
          markerExpr = (childNodes[index + 1] && childNodes[index + 1].id) || undefined;
        }
        if (!markerExpr) {
          const next = nextStaticSkeleton(childNodes, index);
          if (next) {
            const anchorId = createPlaceholder(
              path,
              results,
              rootId,
              sharedAnchors,
              next
            );
            tempPath = anchorId.name;
            markerExpr = anchorId;
          } else {
            // Trailing slot: BG-only marker (`_$marker(root, parent, slot)`).
            // No MT node is created for it — the skeleton keeps its `dyn`
            // entry (nothing emitted), and the runtime appends a `#marker`
            // shadow node to the parent list on first touch (compiled calls
            // run in document order) so resolveAnchor always lands on the
            // correct next sibling. Replaces the old synthesized `<view>`
            // (an MT node per trailing slot that we had to maintain).
            const programData = path.scope.getProgramParent().data as ProgramScopeData;
            const slot = programData.markerNext ?? 0;
            programData.markerNext = slot + 1;
            markerExpr = t.callExpression(
              registerImportMethod(path, "marker", getConfig(path).moduleName),
              [rootId, t.cloneNode(results.id!), t.numericLiteral(slot)]
            );
          }
        }
        results.exprs.push(
          t.expressionStatement(
            t.callExpression(insert, [
              rootId,
              results.id!,
              child.exprs[0] as babelTypes.Expression,
              markerExpr
            ])
          )
        );
      } else if (multi) {
        results.exprs.push(
          t.expressionStatement(
            t.callExpression(insert, [
              rootId,
              results.id!,
              child.exprs[0] as babelTypes.Expression,
              nextChild(childNodes, index) || t.nullLiteral()
            ])
          )
        );
      } else {
        results.exprs.push(
          t.expressionStatement(
            t.callExpression(insert, [
              rootId,
              results.id!,
              child.exprs[0] as babelTypes.Expression
            ])
          )
        );
      }
    }
  });
  results.postExprs.unshift(...childPostExprs);
}

function createPlaceholder(
  path: BabelPath<babelTypes.JSXElement>,
  results: DOMTransformResult,
  rootId: babelTypes.Identifier,
  sharedAnchors: SkeletonAnchor[],
  nextAnchor: SkeletonNode
): babelTypes.Identifier {
  const exprId = path.scope.generateUidIdentifier("el$");
  results.template += "<!>";
  results.templateWithClosingTags += "<!>";
  // lynx: the placeholder has no node in the createCode (dynamic slots
  // emit nothing) — anchor on the next static sibling via the instance refs
  // array (firstId + DFS offset), mirroring the element-reference walk
  // branch. Trailing slots (no static sibling) never reach here: they emit
  // a BG-only `_$marker` call instead (no MT node, no refs entry).
  const anchorIndex =
    sharedAnchors.push({
      index: sharedAnchors.length,
      offset: -1,
      node: nextAnchor
    }) - 1;
  results.declarations.push(
    t.variableDeclarator(
      exprId,
      t.memberExpression(
        t.memberExpression(rootId, t.identifier("refs")),
        t.numericLiteral(anchorIndex),
        true
      )
    )
  );
  return exprId;
}

/** Next static sibling's skeleton after `index` (for lynx placeholder
 *  anchoring — the placeholder anchors on the sibling it precedes).
 *  Trailing slots (nothing after them) are anchored by a BG-only `_$marker`
 *  emitted at the call site instead — no skeleton, MT or refs entry. */
function nextStaticSkeleton(children: TransformResult[], index: number): SkeletonNode | undefined {
  for (let i = index + 1; i < children.length; i++)
    if (children[i] && children[i].skeleton) return children[i]!.skeleton;
  return undefined;
}

function nextChild(children: TransformResult[], index: number): babelTypes.Identifier | undefined {
  return children[index + 1] && (children[index + 1].id || nextChild(children, index + 1));
}

// reduce unnecessary refs
function detectExpressions(
  children: JSXChildPath[],
  index: number,
  config: DOMTransformInfo
): boolean | undefined {
  if (children[index - 1]) {
    const node = children[index - 1].node;
    if (
      t.isJSXExpressionContainer(node) &&
      !t.isJSXEmptyExpression(node.expression) &&
      getStaticExpression(children[index - 1] as BabelPath<babelTypes.JSXExpressionContainer>) ===
        false
    )
      return true;
    let tagName;
    if (t.isJSXElement(node) && (tagName = getTagName(node)) && isComponent(tagName)) return true;
  }
  for (let i = index; i < children.length; i++) {
    const child = children[i].node;
    if (t.isJSXExpressionContainer(child)) {
      if (
        !t.isJSXEmptyExpression(child.expression) &&
        getStaticExpression(children[i] as BabelPath<babelTypes.JSXExpressionContainer>) === false
      )
        return true;
    } else if (t.isJSXElement(child)) {
      const tagName = getTagName(child);
      if (isComponent(tagName)) return true;
      // claim targets (a[href] / form[action]) need an element reference
      // even when fully static — the emitted claimElement call walks to them
      if (isClaimTarget(child)) return true;
      if (
        child.openingElement.attributes.some(
          attr =>
            t.isJSXSpreadAttribute(attr) ||
            (t.isJSXIdentifier(attr.name) &&
              ["textContent", "innerHTML", "innerText"].includes(attr.name.name)) ||
            (t.isJSXNamespacedName(attr.name) && attr.name.namespace.name === "prop") ||
            (t.isJSXExpressionContainer(attr.value) &&
              !(
                t.isStringLiteral(attr.value.expression) ||
                t.isNumericLiteral(attr.value.expression)
              ))
        )
      )
        return true;
      const nextChildren = filterChildren(children[i].get("children"));
      if (nextChildren.length)
        if (detectExpressions(nextChildren as JSXChildPath[], 0, config)) return true;
    }
  }
}

function processSpreads(
  path: BabelPath<babelTypes.JSXElement>,
  attributes: JSXAttributePath[],
  { elem, hasChildren }: SpreadOptions
): [JSXAttributePath[], babelTypes.ExpressionStatement] {
  const config = getConfig(path);
  const tagName = getTagName(path.node);

  // TODO: skip but collect the names of any properties after the last spread to not overwrite them
  const filteredAttributes: JSXAttributePath[] = [];
  const spreadArgs: babelTypes.Expression[] = [];
  let runningObject: Array<babelTypes.ObjectProperty | babelTypes.ObjectMethod> = [];
  let dynamicSpread = false;
  attributes.forEach(attribute => {
    const node = attribute.node;
    const key =
      !t.isJSXSpreadAttribute(node) &&
      (t.isJSXNamespacedName(node.name)
        ? `${node.name.namespace.name}:${node.name.name.name}`
        : node.name.name);
    if (t.isJSXSpreadAttribute(node)) {
      const isStatic =
        node.innerComments &&
        node.innerComments[0] &&
        node.innerComments[0].value.trim() === config.staticMarker;

      if (runningObject.length) {
        spreadArgs.push(t.objectExpression(runningObject));
        runningObject = [];
      }

      const s =
        isDynamic(attribute.get("argument"), {
          checkMember: true
        }) && (dynamicSpread = true)
          ? inlineCallExpression(node.argument)
          : node.argument;

      spreadArgs.push(isStatic ? t.objectExpression([t.spreadElement(s)]) : s);
    } else if (key && key !== "ref") {
      const value = node.value;
      const isContainer = t.isJSXExpressionContainer(value);
      const expression =
        isContainer && !t.isJSXEmptyExpression(value.expression) ? value.expression : undefined;
      const dynamic =
        isContainer && isDynamic(attribute.get("value").get("expression"), { checkMember: true });
      const normalized = isLockedDOMProperty(tagName, key) ? key.replace(/^prop:/, "") : key;
      if (dynamic) {
        const id = isLockedDOMProperty(tagName, key)
          ? t.identifier(normalized)
          : convertJSXIdentifier(node.name);

        // No condition memo here (unlike children/component props): attribute
        // values are primitives, assignProp dedupes writes against prevProps,
        // and the ssr generate emits the bare expression — a client-only memo
        // allocates a hydration id the server never did, drifting every id
        // after it (#2959).
        runningObject.push(
          t.objectMethod(
            "get",
            id,
            [],
            t.blockStatement([t.returnStatement(expression as babelTypes.Expression)]),
            !t.isValidIdentifier(normalized)
          )
        );
      } else {
        runningObject.push(
          t.objectProperty(
            t.stringLiteral(normalized),
            (isContainer
              ? expression
              : node.value || t.booleanLiteral(true)) as babelTypes.Expression
          )
        );
      }
    } else filteredAttributes.push(attribute);
  });

  if (runningObject.length) {
    spreadArgs.push(t.objectExpression(runningObject));
  }

  const props =
    spreadArgs.length === 1 && !dynamicSpread
      ? spreadArgs[0]
      : t.callExpression(registerImportMethod(path, "mergeProps"), spreadArgs);

  return [
    filteredAttributes,
    t.expressionStatement(
      t.callExpression(
        registerImportMethod(path, "spread", getConfig(path).moduleName),
        [elem, props, t.booleanLiteral(hasChildren)]
      )
    )
  ];
}
