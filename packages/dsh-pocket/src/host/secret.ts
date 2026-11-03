/**
 * Gateway secret persistence.
 *
 * The secret signs every device cookie, so it lives in the DSH credentials
 * record when that service is available and in a mode-0600 file otherwise. The
 * file fallback keeps the plugin usable in a minimal composition and gives the
 * tests a store with no DSH dependency.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createSecret, encodeBase64Url, normalizeSecret } from './gateway-auth.ts'

/** The slice of `ctx.credentials` this plugin needs. */
export interface CredentialsLike {
  readRecord(key: unknown): Promise<CredentialRecordLike | undefined>
  modifyRecord(
    key: unknown,
    mutate: (current: CredentialRecordLike | undefined) => Promise<CredentialRecordLike | undefined>,
  ): Promise<CredentialRecordLike | undefined>
}

/** One stored credential record, as far as this plugin reads it. */
export interface CredentialRecordLike {
  kind: string
  payload?: unknown
}

/** Minimal logger surface compatible with the Cordis logger. */
export interface SecretLogger {
  warn(message: string, ...args: unknown[]): void
}

const RECORD_SCOPE = 'dsh-pocket'
const RECORD_ID = 'gateway-session'
const FILE_NAME = 'gateway-session'
const RECORD_VERSION = 1

function payloadSecret(record: CredentialRecordLike | undefined): Buffer | undefined {
  if (record === undefined || record.kind !== 'grant') return undefined
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) return undefined
  const value = payload as Record<string, unknown>
  if (value.version !== RECORD_VERSION) return undefined
  return normalizeSecret(value.secret)
}

function recordFor(secret: Buffer): CredentialRecordLike {
  return { kind: 'grant', payload: { version: RECORD_VERSION, secret: encodeBase64Url(secret) } }
}

/** Resolve the DSH home directory the same way the app does. */
export function resolveDshHome(): string {
  const configured = process.env.DSH_HOME
  if (configured !== undefined && configured !== '') return configured
  return join(process.env.HOME ?? process.cwd(), '.dsh')
}

/** Load-or-create and rotate the gateway signing secret. */
export class SecretStore {
  readonly #credentials: CredentialsLike | undefined
  readonly #filePath: string
  readonly #logger: SecretLogger | undefined
  readonly #credentialKey: unknown
  #secret: Buffer | undefined

  /**
   * @param credentials - the optional DSH credential provider.
   * @param home - DSH home; the file fallback lives under `<home>/pocket`.
   * @param logger - warning sink for a failed credentials read.
   * @param credentialKeyFactory - injected for tests; defaults to the DSH helper lazily.
   */
  constructor(
    credentials: CredentialsLike | undefined,
    home: string,
    logger?: SecretLogger,
    private readonly credentialKeyFactory?: (scope: string, id: string) => unknown,
  ) {
    this.#credentials = credentials
    this.#logger = logger
    this.#filePath = join(home, 'pocket', FILE_NAME)
    this.#credentialKey = credentialKeyFactory?.(RECORD_SCOPE, RECORD_ID)
  }

  /** The current secret, loading or creating it on first use. */
  async load(): Promise<Buffer> {
    if (this.#secret !== undefined) return this.#secret
    this.#secret = (await this.#loadFromCredentials()) ?? (await this.#loadOrCreateFile())
    return this.#secret
  }

  /** Replace the secret, persisting it before the new value is used. */
  async rotate(): Promise<Buffer> {
    const secret = createSecret()
    if (await this.#rotateCredentials(secret)) {
      this.#secret = secret
      return secret
    }
    await this.#writeFile(secret)
    this.#secret = secret
    return secret
  }

  /** The file path, exposed for diagnostics. */
  get filePath(): string {
    return this.#filePath
  }

  async #loadFromCredentials(): Promise<Buffer | undefined> {
    if (this.#credentials === undefined || this.#credentialKey === undefined) return undefined
    try {
      const record = await this.#credentials.readRecord(this.#credentialKey)
      const existing = payloadSecret(record)
      if (existing !== undefined) return existing
      const created = await this.#credentials.modifyRecord(this.#credentialKey, async (current) => {
        if (payloadSecret(current) !== undefined) return undefined
        return recordFor(createSecret())
      })
      const secret = payloadSecret(created)
      if (secret === undefined) throw new Error('credential record was not committed')
      return secret
    } catch (error) {
      this.#logger?.warn(`dsh-pocket: cannot use the credentials store (${String(error)}); falling back to a local secret file`)
      return undefined
    }
  }

  async #rotateCredentials(secret: Buffer): Promise<boolean> {
    if (this.#credentials === undefined || this.#credentialKey === undefined) return false
    try {
      const updated = await this.#credentials.modifyRecord(this.#credentialKey, async () => recordFor(secret))
      return payloadSecret(updated)?.equals(secret) === true
    } catch (error) {
      this.#logger?.warn(`dsh-pocket: cannot rotate the credentials record (${String(error)}); using the local secret file`)
      return false
    }
  }

  async #loadOrCreateFile(): Promise<Buffer> {
    try {
      const existing = normalizeSecret((await readFile(this.#filePath, 'utf8')).trim())
      if (existing !== undefined) return existing
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const secret = createSecret()
    await this.#writeFile(secret)
    return secret
  }

  async #writeFile(secret: Buffer): Promise<void> {
    const directory = dirname(this.#filePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700).catch(() => {})
    await writeFile(this.#filePath, encodeBase64Url(secret), { encoding: 'utf8', mode: 0o600 })
    await chmod(this.#filePath, 0o600).catch(() => {})
  }
}
