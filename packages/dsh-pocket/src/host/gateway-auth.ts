/**
 * Pairing codes and gateway session cookies.
 *
 * The gateway is the only network-facing process, and it owns both halves of
 * its own authentication: a short-lived pairing code proves a human is looking
 * at the Mac, and the signed cookie that follows is the device credential.
 * Everything here is pure and clock-injectable so the timing and lockout rules
 * can be tested without sleeping.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/** Cookie name carrying the gateway device credential. */
export const GATEWAY_COOKIE = 'dsh-pocket-session'

/** Pairing policy, sampled from the plugin config. */
export interface PairingOptions {
  ttlSeconds: number
  maxAttempts: number
  windowSeconds: number
  lockoutSeconds: number
  /** Clock injection for tests; production reads `Date.now`. */
  now?: () => number
  /** Disable the auto-rotation timer in tests. */
  autoRotate?: boolean
}

/** The current code and its absolute expiry. */
export interface PairingSnapshot {
  code: string
  expiresAt: number
  ttlSeconds: number
}

/** Outcome of one pairing attempt. */
export type PairVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' }

interface AttemptState {
  failures: number
  windowStart: number
  blockedUntil: number
}

const GLOBAL_ATTEMPT_MULTIPLIER = 10
const MAX_TRACKED_IPS = 2048

/** Encode bytes as unpadded base64url, matching the browser-auth vocabulary. */
export function encodeBase64Url(value: Buffer): string {
  return value.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/** Decode unpadded base64url and reject non-canonical input. */
export function decodeBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

function constantTimeCodeMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual.padEnd(6, ' '), 'utf8')
  const right = Buffer.from(expected.padEnd(6, ' '), 'utf8')
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

/** Six-digit, single-use pairing codes with per-IP and global brute-force limits. */
export class PairingCodes {
  readonly #ttlMs: number
  readonly #maxAttempts: number
  readonly #windowMs: number
  readonly #lockoutMs: number
  readonly #now: () => number
  readonly #autoRotate: boolean
  readonly #byIp = new Map<string, AttemptState>()
  #code = ''
  #expiresAt = 0
  #timer: NodeJS.Timeout | undefined
  #globalFailures = 0
  #globalWindowStart = 0
  #globalBlockedUntil = 0
  #disposed = false

  constructor(options: PairingOptions) {
    this.#ttlMs = Math.max(1, options.ttlSeconds) * 1000
    this.#maxAttempts = Math.max(1, options.maxAttempts)
    this.#windowMs = Math.max(1, options.windowSeconds) * 1000
    this.#lockoutMs = Math.max(1, options.lockoutSeconds) * 1000
    this.#now = options.now ?? Date.now
    this.#autoRotate = options.autoRotate ?? true
    this.rotate()
  }

  /** Issue a fresh code, replacing the previous one. */
  rotate(): PairingSnapshot {
    this.#code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.#expiresAt = this.#now() + this.#ttlMs
    this.#schedule()
    return this.snapshot()
  }

  /** The current code, rotating first when it has expired. */
  current(): PairingSnapshot {
    if (this.#disposed) return { code: this.#code, expiresAt: this.#expiresAt, ttlSeconds: this.#ttlMs / 1000 }
    if (this.#now() >= this.#expiresAt) this.rotate()
    return this.snapshot()
  }

  /** Read-only view without extending the lifetime. */
  snapshot(): PairingSnapshot {
    return { code: this.#code, expiresAt: this.#expiresAt, ttlSeconds: this.#ttlMs / 1000 }
  }

  /** Verify one attempt and rotate the code on success. */
  verify(code: unknown, ip: string): PairVerifyResult {
    const now = this.#now()
    if (this.#disposed) return { ok: false, reason: 'invalid' }

    if (this.#globalBlockedUntil > now) return { ok: false, reason: 'locked' }
    if (this.#globalWindowStart === 0 || now - this.#globalWindowStart > this.#windowMs) {
      this.#globalWindowStart = now
      this.#globalFailures = 0
    }

    const state = this.#byIp.get(ip)
    if (state !== undefined && state.blockedUntil > now) return { ok: false, reason: 'locked' }
    if (state !== undefined && now - state.windowStart > this.#windowMs) {
      state.failures = 0
      state.windowStart = now
    }

    if (typeof code !== 'string' || !/^\d{6}$/u.test(code)) {
      this.#recordFailure(ip, now)
      return { ok: false, reason: 'invalid' }
    }

    if (now >= this.#expiresAt) {
      this.rotate()
      return { ok: false, reason: 'expired' }
    }

    if (!constantTimeCodeMatch(code, this.#code)) {
      this.#recordFailure(ip, now)
      return { ok: false, reason: 'invalid' }
    }

    this.#byIp.delete(ip)
    this.#globalFailures = 0
    this.rotate()
    return { ok: true }
  }

  /** Stop the rotation timer. */
  dispose(): void {
    this.#disposed = true
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
  }

  #recordFailure(ip: string, now: number): void {
    this.#globalFailures += 1
    if (this.#globalFailures >= this.#maxAttempts * GLOBAL_ATTEMPT_MULTIPLIER) {
      this.#globalBlockedUntil = now + this.#lockoutMs
      this.#globalFailures = 0
    }

    const state = this.#byIp.get(ip) ?? { failures: 0, windowStart: now, blockedUntil: 0 }
    state.failures += 1
    if (state.failures >= this.#maxAttempts) {
      state.blockedUntil = now + this.#lockoutMs
      state.failures = 0
      state.windowStart = now
    }
    this.#byIp.set(ip, state)

    if (this.#byIp.size > MAX_TRACKED_IPS) {
      for (const [key, value] of this.#byIp) {
        if (value.blockedUntil <= now && now - value.windowStart > this.#windowMs) this.#byIp.delete(key)
      }
    }
  }

  #schedule(): void {
    if (!this.#autoRotate || this.#disposed) return
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      if (!this.#disposed) this.rotate()
    }, this.#ttlMs)
    this.#timer.unref?.()
  }
}

/** Signs and verifies the gateway's device cookie. */
export interface CookiePayload {
  v: 1
  iat: number
  exp: number
  sid: string
}

const COOKIE_VERSION = 1
const SECRET_BYTES = 32

/** Validate and normalize a stored gateway secret. */
export function normalizeSecret(value: unknown): Buffer | undefined {
  if (typeof value !== 'string') return undefined
  const decoded = decodeBase64Url(value)
  return decoded !== undefined && decoded.byteLength === SECRET_BYTES ? decoded : undefined
}

/** Generate one 32-byte gateway secret. */
export function createSecret(): Buffer {
  return randomBytes(SECRET_BYTES)
}

/** Signed, authority-independent device cookie. */
export class SessionCookies {
  #secret: Buffer
  readonly #maxAgeDays: number
  readonly #now: () => number

  constructor(secret: Buffer, maxAgeDays: number, now: () => number = Date.now) {
    if (secret.byteLength !== SECRET_BYTES) throw new Error('dsh-pocket: gateway secret must be 32 bytes')
    this.#secret = secret
    this.#maxAgeDays = Math.max(1, maxAgeDays)
    this.#now = now
  }

  /** Issue one cookie value and its absolute expiry. */
  issue(): { value: string; expiresAt: number; sid: string } {
    const issuedAt = this.#now()
    const expiresAt = issuedAt + this.#maxAgeDays * 24 * 60 * 60 * 1000
    const payload: CookiePayload = {
      v: COOKIE_VERSION,
      iat: issuedAt,
      exp: expiresAt,
      sid: encodeBase64Url(randomBytes(16)),
    }
    const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
    return { value: `v1.${body}.${this.#signature(body)}`, expiresAt, sid: payload.sid }
  }

  /** Verify one cookie value, returning its payload only while unexpired and untampered. */
  verify(value: string | undefined): CookiePayload | undefined {
    if (value === undefined) return undefined
    const parts = value.split('.')
    if (parts.length !== 3) return undefined
    const [version, body, signature] = parts
    if (version !== 'v1' || body === undefined || signature === undefined) return undefined
    const actual = decodeBase64Url(signature)
    const expected = this.#signatureBytes(body)
    if (actual === undefined || actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) return undefined
    const decoded = decodeBase64Url(body)
    if (decoded === undefined) return undefined
    let payload: unknown
    try {
      payload = JSON.parse(decoded.toString('utf8'))
    } catch {
      return undefined
    }
    if (typeof payload !== 'object' || payload === null) return undefined
    const record = payload as Record<string, unknown>
    if (record.v !== COOKIE_VERSION) return undefined
    if (typeof record.iat !== 'number' || typeof record.exp !== 'number' || typeof record.sid !== 'string') return undefined
    if (!Number.isSafeInteger(record.iat) || !Number.isSafeInteger(record.exp)) return undefined
    if (record.exp <= this.#now()) return undefined
    return { v: COOKIE_VERSION, iat: record.iat, exp: record.exp, sid: record.sid }
  }

  /** Replace the signing secret, invalidating every cookie issued before. */
  rotate(secret: Buffer): void {
    if (secret.byteLength !== SECRET_BYTES) throw new Error('dsh-pocket: gateway secret must be 32 bytes')
    this.#secret = secret
  }

  /** Render the Set-Cookie header value. */
  cookieHeader(value: string, expiresAt: number, secure: boolean): string {
    const maxAge = Math.max(0, Math.floor((expiresAt - this.#now()) / 1000))
    const parts = [
      `${GATEWAY_COOKIE}=${value}`,
      `Max-Age=${String(maxAge)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ]
    if (secure) parts.push('Secure')
    return parts.join('; ')
  }

  #signature(body: string): string {
    return encodeBase64Url(this.#signatureBytes(body))
  }

  #signatureBytes(body: string): Buffer {
    return createHmac('sha256', this.#secret).update(body).digest()
  }
}

/** Parse a Cookie header into a name -> value record. */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (header === undefined) return result
  for (const segment of header.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1) continue
    const name = segment.slice(0, at).trim()
    if (name === '') continue
    result[name] = segment.slice(at + 1).trim()
  }
  return result
}

/** Deterministic upstream cookie name, mirroring the DSH browser-auth layout. */
export function upstreamCookieName(upstreamOrigin: string): string {
  const authority = new URL(upstreamOrigin).host
  return 'dsh-auth-' + encodeBase64Url(createHash('sha256').update(authority).digest())
}

/** Simple fixed-window limiter for unauthenticated paths. */
export class RateLimiter {
  readonly #limit: number
  readonly #windowMs: number
  readonly #now: () => number
  readonly #counts = new Map<string, { count: number; start: number }>()

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.#limit = Math.max(1, limit)
    this.#windowMs = Math.max(1, windowMs)
    this.#now = now
  }

  /** Record one attempt; false means the caller is over its window budget. */
  take(key: string): boolean {
    const now = this.#now()
    const entry = this.#counts.get(key)
    if (entry === undefined || now - entry.start > this.#windowMs) {
      this.#counts.set(key, { count: 1, start: now })
      return true
    }
    entry.count += 1
    if (this.#counts.size > 4096) {
      for (const [name, value] of this.#counts) {
        if (now - value.start > this.#windowMs) this.#counts.delete(name)
      }
    }
    return entry.count <= this.#limit
  }
}
