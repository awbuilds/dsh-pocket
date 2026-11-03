#!/usr/bin/env node
/**
 * Run the plugin against a disposable `pocket-dev` profile.
 *
 * The Desktop app's profile is reserved and must not be booted from a terminal.
 * This script creates a separate Web profile under a dedicated DSH home, installs
 * the plugin there, selects its bundle, and starts the host. The home has no
 * credentials of its own, so chat needs an account; the UI, pairing flow, and
 * mobile surface are fully testable. Set DSH_POCKET_DEV_HOME to keep the profile,
 * or DSH_HOME when you intentionally want a throwaway process against real data
 * (quit the Desktop app first).
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION, enableBundle, profileDir, readProfileManifest } from './profile.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_DIR = join(ROOT, 'packages', 'dsh-pocket')
const PACKAGE_NAME = '@awbuilds/dsh-pocket'
const PROFILE = 'pocket-dev'
const HOME = process.env.DSH_HOME ?? process.env.DSH_POCKET_DEV_HOME ?? join(homedir(), '.dsh-pocket-dev')
const CLI = ['--yes', `@deepseek-ai/dsh@${DSH_VERSION}`]

function run(args, options = {}) {
  return execFileSync('npx', [...CLI, ...args], {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, DSH_HOME: HOME },
    ...options,
  })
}

if (!existsSync(join(PACKAGE_DIR, 'lib', 'index.js'))) {
  console.error('dsh-pocket: run "pnpm build" before the dev profile.')
  process.exit(1)
}

console.log(`dsh-pocket: dev home ${HOME}`)
let exists = false
try {
  await readProfileManifest(PROFILE, HOME)
  exists = true
} catch {
  exists = false
}

if (!exists) {
  console.log(`dsh-pocket: creating ${PROFILE} from the shipped Web template (first run downloads DSH ${DSH_VERSION})…`)
  try {
    run([PROFILE, '--from-default-profile', 'web', '--dump-config'], { stdio: 'ignore' })
  } catch {
    // Some launcher versions boot instead of dumping; the profile is what matters.
  }
  try {
    await readProfileManifest(PROFILE, HOME)
  } catch (error) {
    console.error(`dsh-pocket: could not create the profile: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

console.log('dsh-pocket: installing the plugin into the dev profile…')
try {
  run(['plugin', '--profile', PROFILE, 'add', PACKAGE_DIR])
} catch {
  console.error('dsh-pocket: package install failed (diagnostic above).')
  process.exit(1)
}

await enableBundle(PROFILE, PACKAGE_NAME, HOME)
console.log(`dsh-pocket: starting ${PROFILE}; the gateway will listen on 0.0.0.0:7317 (fallbacks 7318–7326).`)
console.log('dsh-pocket: open the printed dsh web URL, then click "Link phone" at the bottom of the sidebar.')

const child = spawn('npx', [...CLI, PROFILE, '--no-open', '--port', '0'], {
  stdio: 'inherit',
  cwd: ROOT,
  env: { ...process.env, DSH_HOME: HOME },
})

const stop = (signal) => {
  if (!child.killed) child.kill(signal)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
child.on('exit', (code) => {
  process.exitCode = code ?? 0
})
