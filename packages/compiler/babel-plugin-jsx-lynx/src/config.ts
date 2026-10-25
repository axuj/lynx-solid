export interface JSXDOMExpressionsConfig {
  moduleName: string;
  dev: boolean;
  builtIns: string[];
  requireImportSource: false | string;
  wrapConditionals: boolean;
  omitNestedClosingTags: boolean;
  omitLastClosingTag: boolean;
  omitQuotes: boolean;
  omitAttributeSpacing: boolean;
  staticMarker: string;
  effectWrapper: string | false;
  memoWrapper: string | false;
  inlineStyles: boolean;
}

const config: JSXDOMExpressionsConfig = {
  moduleName: "dom",
  dev: false,
  builtIns: [],
  requireImportSource: false,
  wrapConditionals: true,
  omitNestedClosingTags: false,
  omitLastClosingTag: true,
  omitQuotes: true,
  omitAttributeSpacing: true,
  staticMarker: "@static",
  effectWrapper: "effect",
  memoWrapper: "memo",
  inlineStyles: true
};

export default config;
