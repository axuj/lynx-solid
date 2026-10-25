import { root } from '@lynx-js/react'

import { App } from './App'
import { installPerfProbe } from './perf-probe'

// Before `root.render`: the first-screen pipeline entry is dispatched once the
// marked root flushes, and the observer must already be listening.
installPerfProbe()

root.render(<App />)
