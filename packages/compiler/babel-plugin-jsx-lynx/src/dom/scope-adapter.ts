/**
 * Scope-emission adapter for skeleton create() codegen.
 *
 * This is the ONLY seam through which the skeleton transform knows how
 * scoped CSS reaches a baked element — the same role the scope adapter plays
 * for element templates in vue-lynx (https://github.com/Huxpro/vue-lynx,
 * Apache-2.0): lineages with a different scope model swap the adapter and
 * leave the transform untouched.
 *
 * Current scope model: NONE. This pipeline has no scoped-CSS concept
 * (skeleton bodies never emitted scope statements; the MT executor only
 * ever stamps cssId 0 at creation). `noScopeAdapter` documents that status
 * quo — it emits nothing, so generated createCode is byte-identical with or
 * without the seam. When real scoping lands (numeric cssId via `__SetCSSId`
 * like vue's `cssIdScopeAdapter`, or class tokens like the vapor lineage),
 * implement it here and thread the scope id through `buildCreateCode`.
 */
export interface TemplateScopeAdapter {
  /**
   * Source statements baked into a skeleton's `create()` right after the
   * element bound to `varName` is created, associating it with a CSS scope.
   *
   * @param varName - generated local holding the element handle (e.g. `e0`).
   * @param scopeId - the component's scope id, or `null` for unscoped output.
   */
  elementScopeStatements(varName: string, scopeId: string | null): string[];
}

/** Current behavior: unscoped output, no statements emitted. */
export const noScopeAdapter: TemplateScopeAdapter = {
  elementScopeStatements(_varName: string, _scopeId: string | null): string[] {
    return [];
  },
};
