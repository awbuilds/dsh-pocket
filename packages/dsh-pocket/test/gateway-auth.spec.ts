import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  GATEWAY_COOKIE,
  PairingCodes,
  RateLimiter,
  SessionCookies,
  createSecret,
  encodeBase64Url,
  parseCookieHeader,
  upstreamCookieName,
} from '../src/host/gateway-auth.ts'

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let value = start
  return {
    now: () => value,
    advance: (ms) => {
      value += ms
    },
  }
}

describe('PairingCodes', () => {
  function codes(overrides: Partial<ConstructorParameters<typeof PairingCodes>[0]> = {}): PairingCodes {
    return new PairingCodes({
      ttlSeconds: 60,
      maxAttempts: 3,
      windowSeconds: 300,
      lockoutSeconds: 600,
      autoRotate: false,
      ...overrides,
    })
  }

  it('issues six digits and verifies the current code once', () => {
    const pair = codes()
    const { code } = pair.current()
    expect(code).toMatch(/^\d{6}$/u)
    expect(pair.verify(code, '10.0.0.2')).toEqual({ ok: true })
    // Success rotates, so replaying the same code is no longer accepted.
    expect(pair.verify(code, '10.0.0.2').ok).toBe(false)
    pair.dispose()
  })

  it('expires a code after its TTL', () => {
    const time = clock()
    const pair = codes({ now: time.now })
    const { code } = pair.current()
    time.advance(61_000)
    expect(pair.verify(code, '10.0.0.3')).toEqual({ ok: false, reason: 'expired' })
    pair.dispose()
  })

  it('locks one address after repeated failures and keeps other addresses usable', () => {
    const pair = codes()
    const { code } = pair.current()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(pair.verify('000000', '10.0.0.4')).toEqual({ ok: false, reason: 'invalid' })
    }
    expect(pair.verify(code, '10.0.0.4')).toEqual({ ok: false, reason: 'locked' })
    // A different device is not punished for the first one's failures.
    expect(pair.verify(pair.current().code, '10.0.0.5')).toEqual({ ok: true })
    pair.dispose()
  })

  it('does not accept malformed codes as anything but invalid', () => {
    const pair = codes()
    expect(pair.verify(123456, '10.0.0.6')).toEqual({ ok: false, reason: 'invalid' })
    expect(pair.verify('12ab34', '10.0.0.6')).toEqual({ ok: false, reason: 'invalid' })
    pair.dispose()
  })
})

describe('SessionCookies', () => {
  it('round-trips a cookie and rejects tampering', () => {
    let now = 5_000_000
    const cookies = new SessionCookies(createSecret(), 30, () => now)
    const issued = cookies.issue()
    expect(cookies.verify(issued.value)?.sid).toMatch(/^[A-Za-z0-9_-]+$/u)
    const parts = issued.value.split('.')
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -1)}A`
    expect(cookies.verify(tampered)).toBeUndefined()
    expect(cookies.verify('garbage')).toBeUndefined()
    expect(cookies.verify(undefined)).toBeUndefined()
    now += 31 * 24 * 60 * 60 * 1000
    expect(cookies.verify(issued.value)).toBeUndefined()
  })

  it('rotating the secret invalidates every earlier cookie', () => {
    const cookies = new SessionCookies(createSecret(), 30)
    const issued = cookies.issue()
    expect(cookies.verify(issued.value)).toBeDefined()
    cookies.rotate(createSecret())
    expect(cookies.verify(issued.value)).toBeUndefined()
  })

  it('renders the hardened cookie attributes', () => {
    const cookies = new SessionCookies(createSecret(), 30)
    const issued = cookies.issue()
    const header = cookies.cookieHeader(issued.value, issued.expiresAt, false)
    expect(header.startsWith(`${GATEWAY_COOKIE}=`)).toBe(true)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
    expect(header).not.toContain('Secure')
    expect(cookies.cookieHeader(issued.value, issued.expiresAt, true)).toContain('Secure')
  })
})

describe('upstream cookie name', () => {
  it('matches the DSH authority hash', () => {
    const origin = 'http://127.0.0.1:52356'
    const expected =
      'dsh-auth-' + encodeBase64Url(createHash('sha256').update(new URL(origin).host).digest())
    expect(upstreamCookieName(origin)).toBe(expected)
  })
})

describe('parseCookieHeader', () => {
  it('reads duplicate-free cookie pairs without decoding', () => {
    expect(parseCookieHeader('a=1; b=two=2; malformed; c=')).toEqual({ a: '1', b: 'two=2', c: '' })
    expect(parseCookieHeader(undefined)).toEqual({})
  })
})

describe('RateLimiter', () => {
  it('allows up to the budget inside one window and recovers afterwards', () => {
    let now = 0
    const limiter = new RateLimiter(2, 1000, () => now)
    expect(limiter.take('ip')).toBe(true)
    expect(limiter.take('ip')).toBe(true)
    expect(limiter.take('ip')).toBe(false)
    now = 1001
    expect(limiter.take('ip')).toBe(true)
  })
})
