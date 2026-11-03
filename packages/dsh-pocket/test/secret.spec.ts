import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SecretStore, type CredentialRecordLike, type CredentialsLike } from '../src/host/secret.ts'
import { encodeBase64Url } from '../src/host/gateway-auth.ts'

async function tempHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dsh-pocket-secret-'))
}

function fakeCredentials(): CredentialsLike & { records: Map<string, CredentialRecordLike> } {
  const records = new Map<string, CredentialRecordLike>()
  return {
    records,
    async readRecord(key) {
      return records.get(String(key))
    },
    async modifyRecord(key, mutate) {
      const next = await mutate(records.get(String(key)))
      if (next === undefined) return records.get(String(key))
      records.set(String(key), next)
      return next
    },
  }
}

describe('SecretStore file fallback', () => {
  it('creates a mode-0600 secret once and loads it again', async () => {
    const home = await tempHome()
    const first = new SecretStore(undefined, home)
    const secret = await first.load()
    expect(secret.byteLength).toBe(32)
    const file = await readFile(first.filePath, 'utf8')
    expect(file).toBe(encodeBase64Url(secret))
    expect((await stat(first.filePath)).mode & 0o777).toBe(0o600)

    const second = new SecretStore(undefined, home)
    expect((await second.load()).equals(secret)).toBe(true)
  })

  it('rotates to a different secret and persists it', async () => {
    const home = await tempHome()
    const store = new SecretStore(undefined, home)
    const before = await store.load()
    const after = await store.rotate()
    expect(after.equals(before)).toBe(false)
    const reloaded = new SecretStore(undefined, home)
    expect((await reloaded.load()).equals(after)).toBe(true)
  })
})

describe('SecretStore credentials record', () => {
  it('creates and reuses the gateway-session grant record', async () => {
    const home = await tempHome()
    const credentials = fakeCredentials()
    const store = new SecretStore(credentials, home, undefined, (scope, id) => `${scope}/${id}`)
    const secret = await store.load()
    expect(credentials.records.has('dsh-pocket/gateway-session')).toBe(true)
    const record = credentials.records.get('dsh-pocket/gateway-session')
    expect(record?.kind).toBe('grant')
    expect((record?.payload as { version: number }).version).toBe(1)

    const second = new SecretStore(credentials, home, undefined, (scope, id) => `${scope}/${id}`)
    expect((await second.load()).equals(secret)).toBe(true)
  })

  it('rotates the record rather than the file', async () => {
    const home = await tempHome()
    const credentials = fakeCredentials()
    const store = new SecretStore(credentials, home, undefined, (scope, id) => `${scope}/${id}`)
    const before = await store.load()
    const after = await store.rotate()
    expect(after.equals(before)).toBe(false)
    const record = credentials.records.get('dsh-pocket/gateway-session')
    expect(record).toBeDefined()
  })

  it('falls back to the file when the credentials provider throws', async () => {
    const home = await tempHome()
    const broken: CredentialsLike = {
      async readRecord() {
        throw new Error('nope')
      },
      async modifyRecord() {
        throw new Error('nope')
      },
    }
    const warnings: string[] = []
    const store = new SecretStore(broken, home, { warn: (message) => warnings.push(message) }, (scope, id) => `${scope}/${id}`)
    const secret = await store.load()
    expect(secret.byteLength).toBe(32)
    expect(warnings.length).toBeGreaterThan(0)
    expect((await stat(store.filePath)).mode & 0o777).toBe(0o600)
  })
})
