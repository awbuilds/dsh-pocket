import { describe, expect, it } from 'vitest'
import {
  isLoopbackAddress,
  isLoopbackHost,
  listLanAddresses,
  originFor,
  originsFor,
  type InterfaceAddress,
} from '../src/host/addresses.ts'

function interfaces(): Record<string, InterfaceAddress[]> {
  return {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [{ address: '192.168.1.40', family: 'IPv4', internal: false }],
    en1: [{ address: '10.0.0.9', family: 'IPv4', internal: false }],
    utun4: [{ address: '100.101.102.103', family: 'IPv4', internal: false }],
    bridge0: [{ address: '169.254.10.2', family: 'IPv4', internal: false }],
    en2: [{ address: 'fd00::2', family: 'IPv6', internal: false }],
    en0dup: [{ address: '192.168.1.40', family: 4, internal: false }],
  }
}

describe('listLanAddresses', () => {
  it('keeps routable IPv4 addresses, drops internal/link-local/IPv6, and deduplicates', () => {
    expect(listLanAddresses(interfaces())).toEqual(['192.168.1.40', '10.0.0.9', '100.101.102.103'])
  })

  it('returns an empty list when the machine is offline', () => {
    expect(listLanAddresses({ lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] })).toEqual([])
  })
})

describe('originFor', () => {
  it('formats IPv4 and brackets IPv6', () => {
    expect(originFor('http:', '192.168.1.40', 7317)).toBe('http://192.168.1.40:7317')
    expect(originFor('https:', 'fd00::2', 443)).toBe('https://[fd00::2]:443')
  })
})

describe('originsFor', () => {
  it('deduplicates while preserving order', () => {
    expect(originsFor('http:', ['192.168.1.40', '192.168.1.40', '10.0.0.9'], 7317)).toEqual([
      'http://192.168.1.40:7317',
      'http://10.0.0.9:7317',
    ])
  })
})

describe('loopback classification', () => {
  it('recognizes the address spellings Node reports', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.40')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })

  it('recognizes loopback Host headers only', () => {
    expect(isLoopbackHost('127.0.0.1:7317')).toBe(true)
    expect(isLoopbackHost('localhost:7317')).toBe(true)
    expect(isLoopbackHost('[::1]:7317')).toBe(true)
    expect(isLoopbackHost('192.168.1.40:7317')).toBe(false)
    expect(isLoopbackHost('localhost.evil.example:7317')).toBe(false)
  })
})
