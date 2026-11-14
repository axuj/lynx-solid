// Entry point for the raw Rspeedy CLI.
//
// `sparkling-app-cli` normally writes this file into `.sparkling/` and runs
// `rspeedy build` for you. We keep it checked in so the bundle can be built
// without that wrapper (the 2.0.x wrapper spawns the `rspeedy` binary without
// a shell, which cannot resolve `rspeedy.cmd` on Windows).
// The explicit `.ts` keeps plain `npm run build` working: without nub's runtime
// augmentation, Node's ESM resolver will not add the extension for us.
import appConfig from './app.config.ts'

const config: any = (appConfig as any).default ?? appConfig

export default config.lynxConfig ?? config
