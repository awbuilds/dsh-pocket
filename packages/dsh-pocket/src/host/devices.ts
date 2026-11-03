/**
 * Persistent registry of paired phones/tablets.
 *
 * Cookies are signed and stateless, so the sid inside the cookie is the only
 * device identity. This registry is the allowlist that makes pairing visible:
 * a valid cookie whose sid is absent (removed device, rotated registry, or an
 * older cookie from before this feature) is rejected and sent back to /pair.
 *
 * The file lives under `$DSH_HOME/pocket/devices.json`, is written atomically,
 * and is mode 0600. Last-seen updates are coalesced so a chatty page does not
 * write on every request.
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PocketDevice } from '../shared/types.ts'

const STORE_VERSION = 1
const MAX_LABEL_LENGTH = 80
const MAX_USER_AGENT_LENGTH = 512
const MAX_ADDRESS_LENGTH = 64
const FLUSH_DELAY_MS = 1000

/** Minimal logger surface compatible with the Cordis logger. */
export interface DeviceLogger {
  warn(message: string, ...args: unknown[]): void
}

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed.slice(0, limit)
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Translate a User-Agent into a short, human label for the desktop dialog. */
export function describeDevice(userAgent: string | undefined, model?: string): string {
  const ua = userAgent ?? ''
  if (ua === '' && (model === undefined || model.trim() === '')) return 'Unknown device'
  const hinted = model?.trim()
  const usefulHint = hinted === undefined || hinted === '' || hinted === 'K' ? undefined : hinted

  const browser = /EdgA?\//u.test(ua)
    ? 'Edge'
    : /OPR\//u.test(ua)
      ? 'Opera'
      : /FxiOS\/|Firefox\//u.test(ua)
        ? 'Firefox'
        : /CriOS\/|Chrome\//u.test(ua)
          ? 'Chrome'
          : /Safari\//u.test(ua)
            ? 'Safari'
            : 'Browser'

  if (/Android/iu.test(ua)) {
    const uaModel = /Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|\)|;)/iu.exec(ua)?.[1]?.trim().replace(/\s+Build\/.*$/u, '')
    const chosen = usefulHint ?? (uaModel === undefined || uaModel === '' ? undefined : uaModel)
    const label = chosen === undefined ? `Android · ${browser}` : `${chosen} · ${browser}`
    return label.slice(0, MAX_LABEL_LENGTH)
  }
  if (usefulHint !== undefined) return `${usefulHint} · ${browser}`.slice(0, MAX_LABEL_LENGTH)
  if (/iPhone/iu.test(ua)) return `iPhone · ${browser}`
  if (/iPad/iu.test(ua)) return `iPad · ${browser}`
  if (/iPod/iu.test(ua)) return `iPod · ${browser}`
  if (/Macintosh|Mac OS X/iu.test(ua)) return `Mac · ${browser}`
  if (/Windows/iu.test(ua)) return `Windows · ${browser}`
  if (/Linux/iu.test(ua)) return `Linux · ${browser}`
  return browser
}

function normalizeAddress(value: string | undefined): string | undefined {
  const trimmed = text(value, MAX_ADDRESS_LENGTH)
  if (trimmed === undefined) return undefined
  const withoutMapped = trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed
  return withoutMapped === '::1' ? '127.0.0.1' : withoutMapped
}

function parseDevice(value: unknown): PocketDevice | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const id = text(record.id, 128)
  const createdAt = finite(record.createdAt)
  const lastSeenAt = finite(record.lastSeenAt)
  if (id === undefined || createdAt === undefined || lastSeenAt === undefined) return undefined
  const userAgent = text(record.userAgent, MAX_USER_AGENT_LENGTH)
  const model = text(record.model, MAX_LABEL_LENGTH)
  const address = normalizeAddress(text(record.address, MAX_ADDRESS_LENGTH))
  return {
    id,
    label: text(record.label, MAX_LABEL_LENGTH) ?? describeDevice(userAgent, model),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(model === undefined ? {} : { model }),
    ...(address === undefined ? {} : { address }),
    createdAt,
    lastSeenAt,
  }
}

/** One process-wide device registry for a DSH home. */
export class DeviceRegistry {
  readonly #file: string
  readonly #logger: DeviceLogger | undefined
  readonly #devices = new Map<string, PocketDevice>()
  #loaded = false
  #dirty = false
  #timer: ReturnType<typeof setTimeout> | undefined
  #closed = false

  constructor(homeDir: string, logger?: DeviceLogger) {
    this.#file = join(homeDir, 'pocket', 'devices.json')
    this.#logger = logger
  }

  /** Read the persisted list once; missing or broken files start empty. */
  async load(): Promise<void> {
    if (this.#loaded) return
    this.#loaded = true
    let raw: string
    try {
      raw = await readFile(this.#file, 'utf8')
    } catch {
      return
    }
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; devices?: unknown }
      if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.devices)) return
      for (const entry of parsed.devices) {
        const device = parseDevice(entry)
        if (device !== undefined) this.#devices.set(device.id, device)
      }
    } catch (error) {
      this.#logger?.warn(`dsh-pocket: ignoring unreadable device registry (${String(error)})`)
    }
  }

  /** Whether a sid is currently paired. */
  has(id: string): boolean {
    return this.#devices.has(id)
  }

  /** Snapshot ordered by most recent activity. */
  list(): PocketDevice[] {
    return [...this.#devices.values()]
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .map((device) => ({ ...device }))
  }

  /** Record a successful pairing, or refresh an existing sid. */
  register(input: { id: string; userAgent?: string; address?: string; model?: string }): PocketDevice | undefined {
    const id = text(input.id, 128)
    if (id === undefined) return undefined
    const now = Date.now()
    const userAgent = text(input.userAgent, MAX_USER_AGENT_LENGTH)
    const model = text(input.model, MAX_LABEL_LENGTH)
    const address = normalizeAddress(input.address)
    const existing = this.#devices.get(id)
    const device: PocketDevice = {
      id,
      label: describeDevice(userAgent, model),
      ...(userAgent === undefined ? {} : { userAgent }),
      ...(model === undefined ? {} : { model }),
      ...(address === undefined ? {} : { address }),
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    }
    this.#devices.set(id, device)
    this.#markDirty()
    return { ...device }
  }

  /** Update last-seen metadata; returns false when the sid was removed. */
  touch(id: string, input: { userAgent?: string; address?: string }): boolean {
    const device = this.#devices.get(id)
    if (device === undefined) return false
    device.lastSeenAt = Date.now()
    const userAgent = text(input.userAgent, MAX_USER_AGENT_LENGTH)
    if (userAgent !== undefined) {
      // Keep the label captured at pairing. The model hint is only available on
      // that request, and a later request may legitimately carry a different UA
      // (subresource, browser update), which must not rename the user's phone.
      device.userAgent = userAgent
    }
    const address = normalizeAddress(input.address)
    if (address !== undefined) device.address = address
    this.#markDirty()
    return true
  }

  /** Forget one device; its existing cookie immediately stops authenticating. */
  remove(id: string): boolean {
    const removed = this.#devices.delete(id)
    if (removed) this.#markDirty()
    return removed
  }

  /** Forget every device (used by revoke-all, which also rotates the secret). */
  clear(): void {
    if (this.#devices.size === 0) return
    this.#devices.clear()
    this.#markDirty()
  }

  /** Flush pending changes to disk. */
  async flush(): Promise<void> {
    if (!this.#dirty) return
    this.#dirty = false
    const body = `${JSON.stringify({ version: STORE_VERSION, devices: this.list() }, null, 2)}\n`
    const directory = dirname(this.#file)
    const temporary = `${this.#file}.tmp-${String(process.pid)}`
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700).catch(() => undefined)
      await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.#file)
      await chmod(this.#file, 0o600).catch(() => undefined)
    } catch (error) {
      this.#logger?.warn(`dsh-pocket: cannot persist paired devices (${String(error)})`)
    }
  }

  /** Stop the coalescing timer and flush. */
  async close(): Promise<void> {
    this.#closed = true
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }
    await this.flush()
  }

  #markDirty(): void {
    this.#dirty = true
    if (this.#closed || this.#timer !== undefined) return
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.flush()
    }, FLUSH_DELAY_MS)
    this.#timer.unref?.()
  }
}
