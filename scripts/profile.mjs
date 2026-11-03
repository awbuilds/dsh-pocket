/**
 * Profile bundle activation for the install/dev scripts.
 *
 * A DSH profile selects bundles in `package.json`'s ordered
 * `dsh.profile.bundles` list. Installing a package does not select it, so these
 * helpers append or remove one entry atomically, keeping a timestamped backup
 * of the manifest they touch. They are pure filesystem functions so the test
 * suite can exercise them without a running DSH install.
 */
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The DSH runtime version this plugin is built against. */
export const DSH_VERSION = '0.2.1-rc.5'

/**
 * Resolve one profile directory.
 * @param {string} name profile name
 * @param {string} [home] DSH home
 * @returns {string}
 */
export function profileDir(name, home = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  return join(home, 'profiles', name)
}

/**
 * Read and validate a profile manifest.
 * @param {string} name profile name
 * @param {string} [home] DSH home
 * @returns {Promise<Record<string, any>>}
 */
export async function readProfileManifest(name, home) {
  const file = join(profileDir(name, home), 'package.json')
  if (!existsSync(file)) {
    throw new Error(`profile "${name}" has no package.json; open DeepSeek Harness once to initialize it`)
  }
  const text = await readFile(file, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`profile "${name}" package.json is not valid JSON (${String(error)})`)
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`profile "${name}" package.json is not an object`)
  const bundles = parsed.dsh?.profile?.bundles
  if (bundles !== undefined && !Array.isArray(bundles)) {
    throw new Error(`profile "${name}" has a non-array dsh.profile.bundles`)
  }
  return parsed
}

/**
 * Whether a bundle is already selected.
 * @param {string} name profile name
 * @param {string} bundle package name
 * @param {string} [home] DSH home
 * @returns {Promise<boolean>}
 */
export async function isBundleEnabled(name, bundle, home) {
  const manifest = await readProfileManifest(name, home)
  return (manifest.dsh?.profile?.bundles ?? []).includes(bundle)
}

/**
 * Append a bundle to the selection, leaving an already-selected profile untouched.
 * @param {string} name profile name
 * @param {string} bundle package name
 * @param {string} [home] DSH home
 * @returns {Promise<{ changed: boolean, backup?: string }>}
 */
export async function enableBundle(name, bundle, home) {
  const manifest = await readProfileManifest(name, home)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (bundles.includes(bundle)) return { changed: false }
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  manifest.dsh.profile.bundles = [...bundles, bundle]
  const backup = await writeManifest(name, manifest, home)
  return { changed: true, backup }
}

/**
 * Remove a bundle from the selection.
 * @param {string} name profile name
 * @param {string} bundle package name
 * @param {string} [home] DSH home
 * @returns {Promise<{ changed: boolean, backup?: string }>}
 */
export async function disableBundle(name, bundle, home) {
  const manifest = await readProfileManifest(name, home)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes(bundle)) return { changed: false }
  if (manifest.dsh?.profile !== undefined) manifest.dsh.profile.bundles = bundles.filter((entry) => entry !== bundle)
  const backup = await writeManifest(name, manifest, home)
  return { changed: true, backup }
}

async function writeManifest(name, manifest, home) {
  const dir = profileDir(name, home)
  const file = join(dir, 'package.json')
  await mkdir(dir, { recursive: true })
  const backup = join(dir, `package.json.pocket-backup-${String(Date.now())}`)
  if (existsSync(file)) await copyFile(file, backup)
  const temporary = join(dirname(file), `.package.json.pocket-${String(process.pid)}`)
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
  return backup
}

async function main() {
  const [command, profile, bundle] = process.argv.slice(2)
  const usage = [
    'usage:',
    '  node scripts/profile.mjs status  <profile> <bundle>',
    '  node scripts/profile.mjs enable  <profile> <bundle>',
    '  node scripts/profile.mjs disable <profile> <bundle>',
  ].join('\n')

  if (command === undefined || profile === undefined || bundle === undefined) {
    console.error(usage)
    process.exitCode = 2
    return
  }
  try {
    if (command === 'status') {
      const enabled = await isBundleEnabled(profile, bundle)
      console.log(`${profile}: ${bundle} is ${enabled ? 'enabled' : 'disabled'}`)
      return
    }
    if (command === 'enable') {
      const result = await enableBundle(profile, bundle)
      console.log(
        result.changed
          ? `enabled ${bundle} in ${profile}${result.backup === undefined ? '' : ` (backup: ${result.backup})`}`
          : `${bundle} was already enabled in ${profile}`,
      )
      return
    }
    if (command === 'disable') {
      const result = await disableBundle(profile, bundle)
      console.log(
        result.changed
          ? `disabled ${bundle} in ${profile}${result.backup === undefined ? '' : ` (backup: ${result.backup})`}`
          : `${bundle} was not enabled in ${profile}`,
      )
      return
    }
    console.error(usage)
    process.exitCode = 2
  } catch (error) {
    console.error(`dsh-pocket: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
