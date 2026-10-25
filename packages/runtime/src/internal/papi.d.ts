/**
 * Engine Element PAPI — type surface is provided by the official
 * `@lynx-js/type-element-api` package (ElementRef + declare global
 * `__CreateElement` / `__AppendElement` ...). pkg description:
 * "Type definitions for all Element PAPI provided by the Lynx team".
 *
 * This file keeps only the codebase-wide alias `LynxElement` for
 * `ElementRef` (30+ call sites import it) to keep diff minimal vs the
 * previous hand-rolled `interface LynxElement`.
 */

import type { ElementRef } from '@lynx-js/type-element-api'

export type LynxElement = ElementRef
