import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { disableBundle, enableBundle, isBundleEnabled, profileDir, readProfileManifest } from '../../../scripts/profile.mjs'

async function profile(home: string, name: string, bundles: string[]): Promise<void> {
  const dir = profileDir(name, home)
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: `dsh-profile-${name}`, private: true, dsh: { profile: { bundles } } }, null, 2),
  ).catch(async (error) => {
    const { mkdir } = await import('node:fs/promises')
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: `dsh-profile-${name}`, private: true, dsh: { profile: { bundles } } }, null, 2),
    )
  })
}

describe('profile bundle selection', () => {
  it('appends a missing bundle, is idempotent, and leaves a backup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-pocket-profile-'))
    await profile(home, 'desktop', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])

    const first = await enableBundle('desktop', 'dsh-pocket', home)
    expect(first.changed).toBe(true)
    expect(await isBundleEnabled('desktop', 'dsh-pocket', home)).toBe(true)
    const manifest = await readProfileManifest('desktop', home)
    expect(manifest.dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'dsh-pocket',
    ])
    const files = await readdir(profileDir('desktop', home))
    expect(files.some((name) => name.startsWith('package.json.pocket-backup-'))).toBe(true)

    const second = await enableBundle('desktop', 'dsh-pocket', home)
    expect(second.changed).toBe(false)
  })

  it('removes the bundle and preserves the rest of the manifest', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-pocket-profile-'))
    await profile(home, 'web', ['@deepseek-ai/dsh-base', 'dsh-pocket', '@deepseek-ai/dsh-web-app'])
    const result = await disableBundle('web', 'dsh-pocket', home)
    expect(result.changed).toBe(true)
    expect(await isBundleEnabled('web', 'dsh-pocket', home)).toBe(false)
    const text = await readFile(join(profileDir('web', home), 'package.json'), 'utf8')
    expect(text).toContain('@deepseek-ai/dsh-base')
    expect(text).toContain('@deepseek-ai/dsh-web-app')
    expect(text).not.toContain('"dsh-pocket"')
  })

  it('refuses a missing or malformed profile instead of guessing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-pocket-profile-'))
    await expect(readProfileManifest('missing', home)).rejects.toThrow(/no package.json/u)

    const dir = profileDir('broken', home)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), '{ not json')
    await expect(readProfileManifest('broken', home)).rejects.toThrow(/not valid JSON/u)
  })
})
