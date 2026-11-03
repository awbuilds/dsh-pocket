/**
 * Wire vocabulary shared by the host gateway and the browser half. Types only:
 * the client imports this module with `import type`, so no host code can leak
 * into the browser bundle.
 */

/** Lifecycle state the desktop pairing dialog renders. */
export type PocketStatus = 'starting' | 'running' | 'error' | 'disabled'

/** One short-lived pairing code. */
export interface PairingSnapshot {
  /** Six decimal digits. */
  code: string
  /** Absolute expiry in Unix milliseconds. */
  expiresAt: number
  /** Configured lifetime, for display. */
  ttlSeconds: number
}

/** One phone or tablet paired with the gateway. */
export interface PocketDevice {
  /** Opaque session id inside the signed device cookie. */
  id: string
  /** Friendly label derived from the User-Agent, e.g. `moto g40 fusion · Chrome`. */
  label: string
  /** Full User-Agent retained for diagnostics. */
  userAgent?: string
  /** Android model hint, when the browser exposes one. */
  model?: string
  /** Last observed peer address. */
  address?: string
  /** Unix milliseconds when the device paired. */
  createdAt: number
  /** Unix milliseconds of the most recent authenticated request. */
  lastSeenAt: number
}

/** Response body of `GET /pocket/info` (loopback only). */
export interface PocketInfo {
  status: PocketStatus
  /** Gateway listener protocol. */
  protocol: 'http:' | 'https:'
  /** Gateway listener port, or 0 while it has not bound. */
  port: number
  /** LAN IPv4 addresses the gateway is reachable at. */
  addresses: string[]
  /** Complete origin list, primary first (LAN addresses, configured extras, loopback). */
  origins: string[]
  /** Current pairing code, absent before first use or after a hard failure. */
  pairing?: PairingSnapshot
  /** Loopback origin of the DSH web server the gateway proxies to. */
  upstreamOrigin: string
  /** Whether the gateway listener serves TLS. */
  tls: boolean
  /** Present when status is `error`. */
  error?: string
  /** Package version, for support diagnostics. */
  version: string
  /** Currently paired phones/tablets, most recently active first. */
  devices: PocketDevice[]
}

/** Response body of `POST /pocket/revoke`. */
export interface RevokeResult {
  revokedAt: number
}

/** Response body of `POST /pocket/devices/revoke`. */
export interface RevokeDeviceResult {
  removed: boolean
}

/** Error body used by the pairing endpoints. */
export interface PairError {
  error: 'invalid' | 'expired' | 'locked' | 'bad-request' | 'rate-limited'
  message: string
}
