#!/usr/bin/env node
/**
 * Install dsh-pocket into a DSH profile.
 *
 * The Desktop profile is reserved for the Electron application: DSH 0.2.1's
 * `dsh plugin --profile desktop` is rejected unconditionally, because only the
 * app's installed carrier may manage that profile. The supported route is the
 * app's own **Settings → Plugins** installer, which accepts a local path, a
 * tarball, or a registry package. This script prints those steps.
 *
 * `--manual` writes the dependency and bundle into the Desktop profile and runs
 * the app's bundled pnpm; it requires the app to be fully quit.
 *
 * Other profiles (web/dev) keep the ordinary CLI path.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION, enableBundle, isBundleEnabled, profileDir, readProfileManifest } from './profile.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_DIR = join(ROOT, 'packages', 'dsh-pocket')
const PACKAGE_NAME = '@awbuilds/dsh-pocket'
const PACKAGE_VERSION = '0.0.4'
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const DEFAULT_TARBALL = join(PACKAGE_DIR, `awbuilds-dsh-pocket-${PACKAGE_VERSION}.tgz`)
const APP_BINARY = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
const APP_RUNTIME = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime'

function arg(name, fallback) {
  const at = process.argv.indexOf(name)
  if (at === -1) return fallback
  return process.argv[at + 1] ?? fallback
}

const profile = arg('--profile', 'desktop')
const manual = process.argv.includes('--manual')
const skipInstall = process.argv.includes('--skip-install')
const tarball = resolve(arg('--tarball', DEFAULT_TARBALL))

function fail(message, code = 1) {
  console.error(`\ndsh-pocket: ${message}\n`)
  process.exit(code)
}

/** Robust check: macOS `pgrep` misses the app's main process in some launches. */
function appRunning() {
  if (process.platform !== 'darwin') return false
  try {
    const output = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' })
    return output.includes(APP_BINARY)
  } catch {
    return false
  }
}

function ensureBuild() {
  if (!existsSync(join(PACKAGE_DIR, 'lib', 'index.js')) || !existsSync(join(PACKAGE_DIR, 'lib', 'client.js'))) {
    fail(`the plugin is not built. Run "pnpm build" first (expected ${join(PACKAGE_DIR, 'lib')}).`)
  }
}

function ensureTarball() {
  if (existsSync(tarball)) return tarball
  ensureBuild()
  console.log(`dsh-pocket: packing ${PACKAGE_NAME}@${PACKAGE_VERSION}…`)
  try {
    execFileSync('npm', ['pack', '--pack-destination', PACKAGE_DIR], { cwd: PACKAGE_DIR, stdio: 'inherit' })
  } catch {
    fail('npm pack failed; run "pnpm build" and "npm pack" in packages/dsh-pocket, then retry.')
  }
  if (!existsSync(tarball)) fail(`expected ${tarball} after packing, but it is missing.`)
  return tarball
}

async function manualDesktopInstall() {
  if (appRunning()) {
    fail('quit DeepSeek Harness completely before using --manual (the app locks its profile).')
  }
  try {
    await readProfileManifest(profile, HOME)
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\nOpen the app once, quit it, and retry.`)
  }

  const archive = ensureTarball()
  const dir = profileDir(profile, HOME)
  const file = join(dir, 'package.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.dependencies ??= {}
  manifest.dependencies[PACKAGE_NAME] = `file:${archive}`
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  const bundles = manifest.dsh.profile.bundles ?? []
  if (!bundles.includes(PACKAGE_NAME)) manifest.dsh.profile.bundles = [...bundles, PACKAGE_NAME]

  const backup = join(dir, `package.json.pocket-backup-${String(Date.now())}`)
  await copyFile(file, backup)
  const temporary = join(dir, `.package.json.pocket-${String(process.pid)}`)
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
  console.log(`dsh-pocket: profile updated (backup ${backup})`)

  const node = join(APP_RUNTIME, 'dependencies', 'node', 'bin', 'node')
  const pnpm = join(APP_RUNTIME, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')
  console.log('dsh-pocket: installing package dependencies with the app’s bundled pnpm…')
  try {
    if (existsSync(node) && existsSync(pnpm)) {
      execFileSync(node, [pnpm, 'install'], { cwd: dir, stdio: 'inherit' })
    } else {
      execFileSync('pnpm', ['install'], { cwd: dir, stdio: 'inherit' })
    }
  } catch {
    fail(`the package install failed. Keep the tarball at ${archive}, or install it from the app's Plugins page.`)
  }
  console.log(`
dsh-pocket: installed into the Desktop profile.

Open DeepSeek Harness; the **Link phone** action should appear at the bottom of
the sidebar. If it does not, restart the app once.
`)
}

function printDesktopInstructions() {
  const tarballHint = existsSync(tarball)
    ? tarball
    : `gzip archive: ${DEFAULT_TARBALL} (run "cd packages/dsh-pocket && npm pack" first)`
  console.log(`
dsh-pocket: the Desktop profile can only be managed from inside the app.

DSH 0.2.1 deliberately rejects \`dsh plugin --profile desktop\` from a terminal,
whether or not the app is running. Use the running app instead:

  1. Open **Settings → Plugins** in DeepSeek Harness.
  2. Choose to install a plugin/bundle from a path or file.
  3. Use either:
       local package:  ${PACKAGE_DIR}
       tarball:        ${tarballHint}
     (or, after the npm package is published: ${PACKAGE_NAME}@${PACKAGE_VERSION})
  4. Enable the **${PACKAGE_NAME}** bundle.
  5. If **Link phone** does not appear, restart DeepSeek Harness once.

No quit is needed for the app's installer. If your build's Plugins page does
not accept a local path or tarball, quit the app and run:

  node scripts/install-desktop.mjs --manual
`)
  if (skipInstall) console.log('dsh-pocket: --skip-install is implied for the app-managed Desktop profile.')
}

async function main() {
  if (profile === 'desktop') {
    if (manual) {
      await manualDesktopInstall()
      return
    }
    printDesktopInstructions()
    return
  }

  ensureBuild()
  try {
    await readProfileManifest(profile, HOME)
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\nCreate the profile first, then retry.`)
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
      fail('the package install failed. The exact pnpm diagnostic is above.')
    }
  }

  const result = await enableBundle(profile, PACKAGE_NAME, HOME)
  if (result.changed) console.log(`dsh-pocket: enabled bundle ${PACKAGE_NAME}${result.backup === undefined ? '' : ` (backup ${result.backup})`}`)
  else console.log(`dsh-pocket: bundle ${PACKAGE_NAME} was already enabled`)
  if ((await isBundleEnabled(profile, PACKAGE_NAME, HOME)) !== true) fail('the bundle selection could not be verified')
  console.log(`\ndsh-pocket: ${skipInstall ? 'bundle enabled' : 'installed'} in profile ${profile}.`)
}

await main()
