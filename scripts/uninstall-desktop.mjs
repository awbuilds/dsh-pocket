#!/usr/bin/env node
/**
 * Remove the plugin from a DSH profile: deselect the bundle first, then ask the
 * matching DSH CLI to remove the package. Refuses while the Desktop app runs.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION, disableBundle, profileDir, readProfileManifest } from './profile.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_NAME = 'dsh-pocket'
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profile = process.argv.includes('--profile')
  ? (process.argv[process.argv.indexOf('--profile') + 1] ?? 'desktop')
  : 'desktop'

function appRunning() {
  if (process.platform !== 'darwin') return false
  try {
    execFileSync('pgrep', ['-f', '/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (profile === 'desktop' && appRunning()) {
  console.error('dsh-pocket: quit DeepSeek Harness completely, then rerun this script.')
  process.exit(1)
}

try {
  await readProfileManifest(profile, HOME)
} catch (error) {
  console.error(`dsh-pocket: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

console.log(`dsh-pocket: profile ${profile} at ${profileDir(profile, HOME)}`)

try {
  const result = await disableBundle(profile, PACKAGE_NAME, HOME)
  console.log(
    result.changed
      ? `dsh-pocket: disabled bundle ${PACKAGE_NAME}${result.backup === undefined ? '' : ` (backup ${result.backup})`}`
      : `dsh-pocket: bundle ${PACKAGE_NAME} was not enabled`,
  )
} catch (error) {
  console.error(`dsh-pocket: could not update the bundle selection: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

try {
  execFileSync('npx', ['--yes', `@deepseek-ai/dsh@${DSH_VERSION}`, 'plugin', '--profile', profile, 'remove', PACKAGE_NAME], {
    stdio: 'inherit',
    cwd: ROOT,
  })
} catch {
  console.error(
    'dsh-pocket: the bundle is disabled, but the package removal failed (diagnostic above). ' +
      'The app will no longer load the plugin; remove the package later from the profile package manager if you wish.',
  )
  process.exitCode = 1
  process.exit()
}

const secretFile = join(HOME, 'pocket', 'gateway-session')
if (existsSync(secretFile)) {
  console.log(`dsh-pocket: the local gateway secret remains at ${secretFile}; delete the folder if you want a fresh identity.`)
}
console.log('dsh-pocket: removed. Reopen DeepSeek Harness.')
