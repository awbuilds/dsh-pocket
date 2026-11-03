/**
 * LAN address discovery and origin formatting.
 *
 * The gateway binds all interfaces by default, so every non-internal IPv4
 * address is a candidate the phone can use. The primary address is the one the
 * default route uses, which is what a Wi-Fi phone reaches; the rest stay in the
 * list for the dialog's picker.
 */
import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'

/** Minimal `os.networkInterfaces()` entry shape, injectable in tests. */
export interface InterfaceAddress {
  address: string
  family: string | number
  internal: boolean
}

const PRIVATE_V4 = [/^10\./u, /^192\.168\./u, /^172\.(1[6-9]|2\d|3[01])\./u]

function isIPv4(entry: InterfaceAddress): boolean {
  return entry.family === 'IPv4' || entry.family === 4
}

function isUsable(entry: InterfaceAddress): boolean {
  if (entry.internal || !isIPv4(entry)) return false
  if (entry.address.startsWith('169.254.')) return false
  return entry.address !== '0.0.0.0'
}

function rank(address: string): number {
  if (PRIVATE_V4.some((pattern) => pattern.test(address))) return 0
  if (address.startsWith('100.')) return 1 // CGNAT / Tailscale
  return 2
}

/**
 * Every usable LAN IPv4 address, private ranges first and then by discovery order.
 * @param interfaces - `os.networkInterfaces()` result, injectable for tests.
 * @returns deduplicated addresses.
 */
export function listLanAddresses(
  interfaces: Record<string, InterfaceAddress[] | undefined> = networkInterfaces() as unknown as Record<string, InterfaceAddress[] | undefined>,
): string[] {
  const seen = new Set<string>()
  const addresses: string[] = []
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!isUsable(entry) || seen.has(entry.address)) continue
      seen.add(entry.address)
      addresses.push(entry.address)
    }
  }
  return addresses.sort((left, right) => rank(left) - rank(right))
}

/**
 * The address the default route would use, discovered by connecting a UDP
 * socket. No packet is sent; the kernel only resolves the source address.
 * @param timeoutMs - bound on the lookup.
 * @returns the primary IPv4 address, or undefined when offline.
 */
export async function primaryAddress(timeoutMs = 300): Promise<string | undefined> {
  return await new Promise<string | undefined>((resolve) => {
    const socket = createSocket('udp4')
    let settled = false
    const finish = (value: string | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* already closed */
      }
      resolve(value)
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    timer.unref?.()
    socket.once('error', () => finish(undefined))
    socket.connect(80, '8.8.8.8', () => {
      try {
        finish(socket.address().address)
      } catch {
        finish(undefined)
      }
    })
  })
}

/**
 * Format one origin, bracketing IPv6 literals.
 * @param protocol - listener protocol.
 * @param address - IP literal.
 * @param port - listener port.
 * @returns the origin without a trailing slash.
 */
export function originFor(protocol: 'http:' | 'https:', address: string, port: number): string {
  const host = address.includes(':') ? `[${address}]` : address
  return `${protocol}//${host}:${String(port)}`
}

/**
 * Format the complete origin list, deduplicated.
 * @param protocol - listener protocol.
 * @param addresses - address literals, primary first.
 * @param port - listener port.
 * @returns origins without trailing slashes.
 */
export function originsFor(protocol: 'http:' | 'https:', addresses: readonly string[], port: number): string[] {
  const seen = new Set<string>()
  const origins: string[] = []
  for (const address of addresses) {
    const origin = originFor(protocol, address, port)
    if (seen.has(origin)) continue
    seen.add(origin)
    origins.push(origin)
  }
  return origins
}

/** Whether a value is one of the loopback address spellings Node reports. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  return address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

/** Whether a Host header names a loopback authority. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false
  try {
    const hostname = new URL(`http://${host}`).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}
