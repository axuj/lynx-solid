/**
 * Background Thread auto-init module — prepended to every background
 * entry by pluginSolidLynx (vue-lynx's entry-background model: a
 * top-level-side-effect module the user never imports). Calls
 * initBackground() so the event bridge, ops transport and env stubs are
 * wired before user code runs. Tests bypass this file and call
 * initBackground() directly with a fake tt.
 */
// MUST be first: installs the global queueMicrotask before solid can read the
// bare identifier — see the shim's header. Side-effect leaf → order = import
// order.

import '../internal/queue-microtask-shim'
import { initBackground } from './entry'

initBackground()
