import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply, type PocketConfig } from '../src/host/index.ts'

interface FakeRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: any, res: any) => void | Promise<void>
}

function fakeContext(): {
  ctx: any
  routes: Map<string, FakeRoute>
  disposers: Array<() => void>
  taps: Array<(html: string) => string>
} {
  const routes = new Map<string, FakeRoute>()
  const disposers: Array<() => void> = []
  const taps: Array<(html: string) => string> = []
  let port = 0
  const ctx = {
    webServer: {
      get port() {
        return port
      },
      set port(value: number) {
        port = value
      },
      protocol: 'http:',
      host: '127.0.0.1',
      getOrigin: () => 'http://127.0.0.1:43210',
      register: (route: FakeRoute) => {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
      tapIndex: (transform: (html: string) => string) => {
        taps.push(transform)
        return () => {
          const at = taps.indexOf(transform)
          if (at !== -1) taps.splice(at, 1)
        }
      },
    },
    connection: {
      authenticatedUrl: (url: string) => `${url}?token=test-token`,
      requestRejection: () => undefined,
    },
    get: () => undefined,
    effect: (factory: () => () => void) => {
      const dispose = factory()
      disposers.push(dispose)
      return dispose
    },
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  }
  return { ctx, routes, disposers, taps }
}

function config(overrides: Partial<PocketConfig> = {}): PocketConfig {
  return {
    enabled: true,
    port: 0,
    portAttempts: 1,
    bindHost: '127.0.0.1',
    cookieMaxAgeDays: 30,
    pairingTtlSeconds: 300,
    pairingMaxAttempts: 10,
    pairingWindowSeconds: 300,
    pairingLockoutSeconds: 900,
    publicOrigins: [],
    ...overrides,
  }
}

interface Captured {
  statusCode: number
  headers: Record<string, unknown>
  body: string
  headersSent: boolean
  writeHead: (status: number, headers?: Record<string, unknown>) => Captured
  end: (chunk?: unknown) => void
}

function response(): Captured {
  const captured: Captured = {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    writeHead(status, headers = {}) {
      this.statusCode = status
      this.headers = headers
      this.headersSent = true
      return this
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk)
    },
  }
  return captured
}

async function callInfo(routes: Map<string, FakeRoute>): Promise<{ status: number; info: any }> {
  const route = routes.get('/pocket/info')
  expect(route).toBeDefined()
  const res = response()
  await route?.handler(
    { method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:7317' } },
    res,
  )
  return { status: res.statusCode, info: JSON.parse(res.body) }
}

const originalHome = process.env.DSH_HOME
let home = ''

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-pocket-host-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
})

describe('host plugin apply', () => {
  it('starts the gateway, exposes info on the loopback route, and adds the index transform', async () => {
    const fake = fakeContext()
    await apply(fake.ctx, config())
    const { status, info } = await callInfo(fake.routes)
    expect(status).toBe(200)
    expect(info.status).toBe('running')
    expect(info.port).toBeGreaterThan(0)
    expect(info.pairing.code).toMatch(/^\d{6}$/u)
    expect(info.origins).toContain(`http://127.0.0.1:${String(info.port)}`)
    expect(fake.taps.length).toBe(1)
    expect(fake.taps[0]?.('<html><head><meta name="viewport" content="width=device-width" /></head></html>')).toContain(
      'viewport-fit=cover',
    )

    for (const dispose of fake.disposers.reverse()) dispose()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(fetch(`http://127.0.0.1:${String(info.port)}/healthz`)).rejects.toBeTruthy()
    expect(fake.routes.size).toBe(0)
    expect(fake.taps.length).toBe(0)
  })

  it('reports disabled without starting a listener', async () => {
    const fake = fakeContext()
    await apply(fake.ctx, config({ enabled: false }))
    const { status, info } = await callInfo(fake.routes)
    expect(status).toBe(200)
    expect(info.status).toBe('disabled')
    expect(info.port).toBe(0)
    expect(info.error).toContain('disabled')
    for (const dispose of fake.disposers.reverse()) dispose()
  })

  it('reports a TLS configuration error without failing the plugin', async () => {
    const fake = fakeContext()
    await apply(fake.ctx, config({ tlsCertFile: '/definitely/not/here.pem', tlsKeyFile: '' }))
    const { info } = await callInfo(fake.routes)
    expect(info.status).toBe('error')
    expect(info.error).toContain('tlsKeyFile')
    for (const dispose of fake.disposers.reverse()) dispose()
  })

  it('rejects control requests from a non-loopback socket or host', async () => {
    const fake = fakeContext()
    await apply(fake.ctx, config({ enabled: false }))
    const route = fake.routes.get('/pocket/info')
    const badSocket = response()
    await route?.handler(
      { method: 'GET', socket: { remoteAddress: '192.168.1.20' }, headers: { host: '192.168.1.20:7317' } },
      badSocket,
    )
    expect(badSocket.statusCode).toBe(403)

    const badHost = response()
    await route?.handler(
      { method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'evil.example:7317' } },
      badHost,
    )
    expect(badHost.statusCode).toBe(403)
    for (const dispose of fake.disposers.reverse()) dispose()
  })
})
