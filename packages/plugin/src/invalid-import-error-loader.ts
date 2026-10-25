/**
 * invalid-import-error-loader — ReactLynx `background-only` marker guard,
 * ported from `plugin-react/src/loaders/invalid-import-error-loader.ts`.
 *
 * `background-only` resolves per layer via rule-scoped aliases: BG → the
 * marker package's empty.js, MAIN_THREAD → its error.js. This loader is
 * attached to error.js on the MAIN_THREAD layer, so any main-thread module
 * reaching a poisoned (BG-only) module fails the build. The thrown message
 * is static; rspack's module chain names the importer (the error module's
 * issuer), matching how the official plugin reports it.
 */

interface InvalidImportOptions {
  message: string
}

export default function invalidImportErrorLoader(
  this: { getOptions: () => InvalidImportOptions },
): never {
  const { message } = this.getOptions()
  throw new Error(message)
}
