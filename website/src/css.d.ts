/**
 * Ambient declarations for side-effect style imports.
 *
 * Lets tsc (and the editor) resolve `import '....css'` in `src/`. Kept
 * minimal on purpose — component styles ship with their own JS imports.
 */
declare module '*.css'
