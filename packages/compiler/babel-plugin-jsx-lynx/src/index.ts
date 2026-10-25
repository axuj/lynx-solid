import SyntaxJSX from "@babel/plugin-syntax-jsx";
import { transformJSX } from "./shared/transform";
import { transformRunOnMainThread } from "./dom/element";
import postprocess from "./shared/postprocess";
import preprocess from "./shared/preprocess";
import type { ParserOptions, PluginObj } from "@babel/core";
import type { JSXDOMExpressionsPass } from "./types";

export default (): PluginObj<JSXDOMExpressionsPass> => {
  return {
    name: "JSX DOM Expressions",
    inherits: SyntaxJSX.default,
    manipulateOptions(_opts: unknown, parserOpts: ParserOptions) {
      const plugins = parserOpts.plugins ?? []
      const hasImportAttributes = plugins.some(
        p => (typeof p === 'string' ? p : p[0]) === 'importAttributes',
      )
      if (!hasImportAttributes)
        plugins.push('importAttributes')
    },
    visitor: {
      JSXElement: transformJSX,
      JSXFragment: transformJSX,
      Program: {
        enter: preprocess,
        exit(path, state) {
          transformRunOnMainThread(path)
          postprocess(path, state)
        }
      }
    }
  };
};

// Re-export worklet helpers (directive detection + handler resolution;
// body codegen lives in the official SWC transform now).
export {
  assertCrossableWorkletCaptures,
  getMainThreadHandlerPath,
  hasMainThreadDirective,
} from "./lynx-worklet";
