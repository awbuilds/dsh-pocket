#!/usr/bin/env node
/**
 * Install the plugin into a DSH profile and select its bundle.
 *
 * The Desktop profile is reserved for the Electron application: its package
 * manager is only safe while the app is fully quit, and the bundle is selected
 * in the profile's own `package.json`. This script checks both, installs with
 * the matching DSH CLI version, then appends the bundle. It is deliberately
 * verbose and refuses to guess when a prerequisite is missing.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION, enableBundle, isBundleEnabled, profileDir, readProfileManifest } from './profile.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_DIR = join(ROOT, 'packages', 'dsh-pocket')
const PACKAGE_NAME = 'dsh-pocket'
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

function arg(name, fallback) {
  const at = process.argv.indexOf(name)
  if (at === -1) return fallback
  return process.argv[at + 1] ?? fallback
}

const profile = arg('--profile', 'desktop')
const skipInstall = process.argv.includes('--skip-install')

function fail(message, code = 1) {
  console.error(`\ndsh-pocket: ${message}\n`)
  process.exit(code)
}

function appRunning() {
  if (process.platform !== 'darwin') return false
  try {
    execFileSync('pgrep', ['-f', '/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!existsSync(join(PACKAGE_DIR, 'lib', 'index.js')) || !existsSync(join(PACKAGE_DIR, 'lib', 'client.js'))) {
  fail(`the plugin is not built. Run "pnpm build" first (expected ${join(PACKAGE_DIR, 'lib')}).`)
}

if (profile === 'desktop' && appRunning()) {
  fail(
    'DeepSeek Harness is still running. Quit it completely (menu bar → Quit, not just close the window), then rerun this script.',
  )
}

try {
  await readProfileManifest(profile, HOME)
} catch (error) {
  fail(
    `${error instanceof Error ? error.message : String(error)}\n` +
      (profile === 'desktop'
        ? 'Open DeepSeek Harness once to initialize its profile, then quit it and rerun.'
        : 'Create the profile first (for example: npx @deepseek-ai/dsh@' + DSH_VERSION + ' ' + profile + ' --from-default-profile web --dump-config).'),
  )
}

console.log(`dsh-pocket: profile ${profile} at ${profileDir(profile, HOME)}`)

if (!skipInstall) {
  console.log(`dsh-pocket: installing ${PACKAGE_DIR} with DSH ${DSH_VERSION} (the first run downloads the CLI)…`)
  try {
    execFileSync(
      'npx',
      ['--yes', `@deepseek-ai/dsh@${DSH_VERSION}`, 'plugin', '--profile', profile, 'add', PACKAGE_DIR],
      { stdio: 'inherit', cwd: ROOT },
    )
  } catch {
    fail(
      'the package install failed. The exact pnpm diagnostic is above. You can also install from the app: ' +
        'Settings → Plugins → install a bundle from a local path, then reopen this script with --skip-install to select it.',
    )
  }
}

try {
  const result = await enableBundle(profile, PACKAGE_NAME, HOME)
  if (result.changed) console.log(`dsh-pocket: enabled bundle ${PACKAGE_NAME}${result.backup === undefined ? '' : ` (backup ${result.backup})`}`)
  else console.log(`dsh-pocket: bundle ${PACKAGE_NAME} was already enabled`)
  if ((await isBundleEnabled(profile, PACKAGE_NAME, HOME)) !== true) fail('the bundle selection could not be verified')
} catch (error) {
  fail(`the bundle could not be enabled: ${error instanceof Error ? error.message : String(error)}`)
}

console.log(`
dsh-pocket: ${skipInstall ? 'bundle enabled' : 'installed'}.

Next:
  1. Reopen DeepSeek Harness.
  2. At the bottom of the left sidebar, click "Link phone".
  3. Scan the QR code with your phone (same Wi-Fi), then approve the connection.

The gateway listens on 0.0.0.0:7317 and falls back to 7318–7326 if that port is
busy. macOS may ask for incoming-connection permission the first time; allow it.
`)
