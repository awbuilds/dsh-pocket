#!/usr/bin/env node
/**
 * Remove dsh-pocket from a DSH profile.
 *
 * The Desktop profile is app-managed: DSH 0.2.1's CLI rejects
 * `plugin --profile desktop`, so the supported route is the app's
 * **Settings → Plugins** page. `--manual` edits the profile manifest and runs
 * the app's bundled pnpm after the app is fully quit.
 *
 * Other profiles keep the ordinary CLI removal.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION, disableBundle, profileDir, readProfileManifest } from './profile.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_NAME = '@awbuilds/dsh-pocket'
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const APP_BINARY = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
const APP_RUNTIME = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime'

function arg(name, fallback) {
  const at = process.argv.indexOf(name)
  if (at === -1) return fallback
  return process.argv[at + 1] ?? fallback
}

const profile = arg('--profile', 'desktop')
const manual = process.argv.includes('--manual')

function appRunning() {
  if (process.platform !== 'darwin') return false
  try {
    const output = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' })
    return output.includes(APP_BINARY)
  } catch {
    return false
  }
}

function printDesktopInstructions() {
  console.log(`
dsh-pocket: the Desktop profile is managed by the app.

Remove it there:
  1. Open **Settings → Plugins** in DeepSeek Harness.
  2. Disable or remove the **${PACKAGE_NAME}** bundle.
  3. Restart DeepSeek Harness if the UI asks.

The package remains in the profile until removed. For a manifest-level removal
instead, quit the app completely and run:

  node scripts/uninstall-desktop.mjs --manual
`)
}

async function manualDesktopRemove() {
  if (appRunning()) {
    console.error('dsh-pocket: quit DeepSeek Harness completely before using --manual.')
    process.exit(1)
  }
  try {
    await readProfileManifest(profile, HOME)
  } catch (error) {
    console.error(`dsh-pocket: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }

  const dir = profileDir(profile, HOME)
  const file = join(dir, 'package.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  if (manifest.dependencies !== undefined) delete manifest.dependencies[PACKAGE_NAME]
  if (manifest.dsh?.profile?.bundles !== undefined) {
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((entry) => entry !== PACKAGE_NAME)
  }
  const backup = join(dir, `package.json.pocket-backup-${String(Date.now())}`)
  await copyFile(file, backup)
  const temporary = join(dir, `.package.json.pocket-${String(process.pid)}`)
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
  console.log(`dsh-pocket: profile updated (backup ${backup})`)

  const node = join(APP_RUNTIME, 'dependencies', 'node', 'bin', 'node')
  const pnpm = join(APP_RUNTIME, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')
  try {
    if (existsSync(node) && existsSync(pnpm)) execFileSync(node, [pnpm, 'install'], { cwd: dir, stdio: 'inherit' })
    else execFileSync('pnpm', ['install'], { cwd: dir, stdio: 'inherit' })
  } catch {
    console.error('dsh-pocket: the profile manifest was updated, but pnpm install failed; run it manually in the profile.')
    process.exitCode = 1
  }
  const secretFile = join(HOME, 'pocket', 'gateway-session')
  if (existsSync(secretFile)) {
    console.log(`dsh-pocket: the local gateway secret remains at ${secretFile}; delete the folder for a fresh identity.`)
  }
  console.log('dsh-pocket: removed from the Desktop profile. Reopen DeepSeek Harness.')
}

if (profile === 'desktop') {
  if (manual) await manualDesktopRemove()
  else printDesktopInstructions()
  process.exit()
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
  console.error('dsh-pocket: the bundle is disabled, but the package removal failed (diagnostic above).')
  process.exitCode = 1
}
