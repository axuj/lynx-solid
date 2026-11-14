/**
 * One-command Android build: bundle -> copy assets -> gradle -> install/launch.
 *
 * Why not `sparkling-app-cli run:android`? The 2.0.x CLI spawns the `rspeedy`
 * binary without a shell, and Windows cannot resolve `rspeedy.cmd` that way.
 * This script runs the same steps with `shell: true`, and is a readable
 * reference for what the CLI does internally.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { copyAssets } from './copy-assets.mjs'
import { resolveToolchain } from './toolchain.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const toolchain = resolveToolchain()
if (!toolchain.ok) {
  console.error('\nAndroid toolchain not found.')
  console.error(`  JAVA_HOME: ${toolchain.javaHome ?? 'missing'}`)
  console.error(`  ANDROID_HOME: ${toolchain.androidSdk ?? 'missing'}`)
  if (toolchain.missing.length)
    console.error(`  missing: ${toolchain.missing.join(', ')}`)
  console.error('\nCopy .env.example to .env.local and set JAVA_HOME / ANDROID_HOME, or export them.')
  process.exit(1)
}
Object.assign(process.env, toolchain.env)
console.log(`[toolchain] JAVA_HOME=${toolchain.javaHome} ANDROID_HOME=${toolchain.androidSdk}`)
const androidDir = path.join(root, 'android')
const gradlew = path.join(
  androidDir,
  process.platform === 'win32' ? 'gradlew.bat' : 'gradlew',
)

function run(command, args, options = {}) {
  const printable = [command, ...args].join(' ')
  console.log(`\n> ${printable}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: root,
    shell: true,
    ...options,
  })
  if (result.status !== 0) {
    if (options.allowFailure)
      return false
    process.exit(result.status ?? 1)
  }
  return true
}

function hasDevice() {
  const result = spawnSync('adb', ['devices'], { encoding: 'utf8', shell: true })
  return /^\S+\s+device$/m.test(result.stdout ?? '')
}

// 1. Native modules referenced from package.json -> Gradle links. Android
//    only: this example has no iOS shell, and the CLI would create one.
run('sparkling-app-cli', ['autolink', '--platform', 'android'])

// 2. Solid JSX -> .lynx.bundle (rspeedy resolves lynx.config.ts).
run('rspeedy', ['build', '--config', './lynx.config.ts'])

// 3. Bundle + static assets -> android/app/src/main/assets.
copyAssets()

// 4. Gradle. SPARKLING_USE_NATIVE_ASSETS=true makes the APK use the copied
//    assets instead of the repo-level dist/ folder.
const env = { ...process.env, SPARKLING_USE_NATIVE_ASSETS: 'true' }
run(gradlew, ['assembleDebug'], { cwd: androidDir, env })

const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
console.log(`\nAPK: ${apk}`)
if (!existsSync(apk))
  process.exit(1)

// 5. Install + launch when a device is attached; otherwise stop after the APK.
if (!hasDevice()) {
  console.log('\nNo adb device connected — APK built, skipping install.')
  process.exit(0)
}

run(gradlew, ['installDebug'], { cwd: androidDir, env })
run('adb', ['shell', 'monkey', '-p', 'com.lynxsolid.demo', '-c', 'android.intent.category.LAUNCHER', '1'], {
  allowFailure: true,
})
console.log('\nDone. The app is on the device.')
