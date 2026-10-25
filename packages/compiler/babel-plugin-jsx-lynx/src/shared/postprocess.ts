import * as t from "@babel/types";
import { appendTemplates as appendTemplatesDOM } from "../dom/template";
import type { NodePath } from "@babel/traverse";
import type {
  BabelHubWithMetadata,
  BabelFileWithMetadata,
  JSXDOMExpressionsPass,
  LynxExtractedTemplate,
  ProgramScopeData
} from "../types";

// add to the top/bottom of the module.
export default (path: NodePath<t.Program>, state: JSXDOMExpressionsPass) => {
  if (state.skip) return;

  const data = path.scope.data as ProgramScopeData;
  const config = (path.hub as unknown as BabelHubWithMetadata).file.metadata.config;
  if (!config) return;
  if (data.templates?.length) {
    const templates = data.templates;
    appendTemplatesDOM(path, templates);
    const extracted: LynxExtractedTemplate[] = templates
      .filter(temp => temp.createCode)
      .map(temp => {
        const anchors = (temp.anchors ?? [])
          .slice()
          .sort((a, b) => a.index - b.index)
        return {
          id: temp.lynxId!,
          createCode: temp.createCode!,
          nodeCount: temp.nodeCount!,
          anchors: anchors.map(a => ({ index: a.index, offset: a.offset })),
        }
      });
    if (extracted.length) {
      const file = (path.hub as unknown as BabelHubWithMetadata).file as BabelFileWithMetadata;
      file.metadata.lynxTemplates = extracted;
    }
  }
  // Worklets are collected independently of templates — every module needs
  // its main-thread handlers registered on the MT.
  {
    const file = (path.hub as unknown as BabelHubWithMetadata).file as BabelFileWithMetadata;
    const data = path.scope.getProgramParent().data as ProgramScopeData;
    if (data.worklets?.length)
      file.metadata.lynxWorklets = data.worklets;
  }
};
