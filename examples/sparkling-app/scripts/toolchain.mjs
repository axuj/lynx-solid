/**
 * Resolve the JDK and Android SDK this example needs.
 *
 * This exists because the toolchain is not always on PATH, and each new shell
 * (or agent session) would otherwise have to rediscover it. The lookup order:
 *
 *   1. `.env.local` (gitignored, per machine)
 *   2. `JAVA_HOME` / `ANDROID_HOME` / `ANDROID_SDK_ROOT` from the environment
 *   3. `android/local.properties` (`sdk.dir`, written by Android Studio)
 *   4. common install locations (Android Studio JBR, `~/android-toolchain`, …)
 *
 * `scripts/android.mjs` applies the result to its child processes. Run this
 * file directly to print what was found:
 *
 *   node scripts/toolchain.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'

function readEnvFile(file) {
  if (!existsSync(file))
    return {}
  const values = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const equals = trimmed.indexOf('=')
    if (equals <= 0)
      continue
    let value = trimmed.slice(equals + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1)
    }
    values[trimmed.slice(0, equals).trim()] = value
  }
  return values
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate))
      return candidate
  }
  return null
}

function localPropertiesSdk() {
  const file = path.join(root, 'android', 'local.properties')
  if (!existsSync(file))
    return null
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find(entry => entry.trim().startsWith('sdk.dir='))
  if (!line)
    return null
  return line.slice(line.indexOf('=') + 1).trim().replace(/\\\\/g, '\\')
}

function javaVersionOf(javaHome) {
  const release = path.join(javaHome, 'release')
  if (existsSync(release)) {
    const match = readFileSync(release, 'utf8').match(/JAVA_VERSION="([^"]+)"/)
    if (match)
      return match[1]
  }
  try {
    const output = execFileSync(path.join(javaHome, 'bin', isWindows ? 'java.exe' : 'java'), ['-version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return output.match(/version "([^"]+)"/)?.[1] ?? null
  }
  catch (error) {
    const text = `${error?.stderr ?? ''}${error?.stdout ?? ''}`
    return text.match(/version "([^"]+)"/)?.[1] ?? null
  }
}

function sdkProblems(androidSdk) {
  const missing = []
  if (!existsSync(path.join(androidSdk, 'platforms', 'android-34')))
    missing.push('platforms/android-34')
  if (!existsSync(path.join(androidSdk, 'build-tools', '34.0.0')))
    missing.push('build-tools/34.0.0')
  if (!existsSync(path.join(androidSdk, 'platform-tools', isWindows ? 'adb.exe' : 'adb')))
    missing.push('platform-tools/adb')
  return missing
}

export function resolveToolchain() {
  const local = readEnvFile(path.join(root, '.env.local'))
  const env = process.env
  const home = os.homedir()
  const localAppData = env.LOCALAPPDATA

  // `.env.local` wins over the shell so a project can pin its own JDK without
  // changing the machine-wide one.
  const javaHome = firstExisting([
    local.JAVA_HOME,
    env.JAVA_HOME,
    localAppData && path.join(localAppData, 'Programs', 'Android Studio', 'jbr'),
    'C:/Program Files/Android/Android Studio/jbr',
    path.join(home, 'android-toolchain', 'jdk-17.0.2'),
  ])

  const androidSdk = firstExisting([
    local.ANDROID_HOME,
    local.ANDROID_SDK_ROOT,
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    localPropertiesSdk(),
    localAppData && path.join(localAppData, 'Android', 'Sdk'),
    path.join(home, 'android-toolchain', 'sdk'),
    path.join(home, 'Android', 'Sdk'),
    path.join(home, 'Library', 'Android', 'sdk'),
  ])

  const javaVersion = javaHome ? javaVersionOf(javaHome) : null
  const missing = androidSdk ? sdkProblems(androidSdk) : ['android sdk']
  const pathParts = [
    javaHome && path.join(javaHome, 'bin'),
    androidSdk && path.join(androidSdk, 'platform-tools'),
    env.PATH,
  ].filter(Boolean)

  return {
    ok: Boolean(javaHome && androidSdk && missing.length === 0),
    javaHome,
    javaVersion,
    androidSdk,
    missing,
    env: {
      ...(javaHome ? { JAVA_HOME: javaHome } : {}),
      ...(androidSdk ? { ANDROID_HOME: androidSdk, ANDROID_SDK_ROOT: androidSdk } : {}),
      PATH: pathParts.join(path.delimiter),
    },
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const toolchain = resolveToolchain()
  console.log(`JAVA_HOME=${toolchain.javaHome ?? '(not found)'}`)
  if (toolchain.javaVersion)
    console.log(`Java=${toolchain.javaVersion}`)
  console.log(`ANDROID_HOME=${toolchain.androidSdk ?? '(not found)'}`)
  if (toolchain.missing.length) {
    console.error(`missing: ${toolchain.missing.join(', ')}`)
    console.error('Copy .env.example to .env.local and point JAVA_HOME / ANDROID_HOME at your toolchain.')
    process.exitCode = 1
  }
}
