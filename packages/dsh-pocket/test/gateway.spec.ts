import { createServer, type Server } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import selfsigned from 'selfsigned'
import { WebSocket, WebSocketServer } from 'ws'
import { PocketGateway } from '../src/host/gateway.ts'
import { GATEWAY_COOKIE, createSecret, upstreamCookieName } from '../src/host/gateway-auth.ts'

const INDEX = '<!doctype html><html><head><meta name="viewport" content="width=device-width" /></head><body>app-shell</body></html>'

interface Upstream {
  origin: string
  state: { headers: Record<string, unknown> }
  close: () => Promise<void>
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function startUpstream(): Promise<Upstream> {
  const state: { headers: Record<string, unknown> } = { headers: {} }
  const server: Server = createServer((req, res) => {
    state.headers = { ...req.headers }
    const url = new URL(req.url ?? '/', 'http://fake.invalid')
    const port = (server.address() as AddressInfo).port
    const cookieName = upstreamCookieName(`http://127.0.0.1:${String(port)}`)
    const hasCookie = String(req.headers.cookie ?? '').includes(`${cookieName}=ok`)

    if (url.pathname === '/api/echo') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ headers: req.headers, method: req.method }))
      return
    }
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write('data: one\n\n')
      setTimeout(() => res.end('data: two\n\n'), 20)
      return
    }
    if (url.pathname === '/') {
      if (url.searchParams.get('token') === 'process-token') {
        res.writeHead(303, {
          location: './',
          'set-cookie': `${cookieName}=ok; Path=/; HttpOnly; SameSite=Strict`,
        })
        res.end()
        return
      }
      if (hasCookie) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(INDEX)
        return
      }
      res.writeHead(401, { 'content-type': 'text/plain' })
      res.end('dsh web authentication required')
      return
    }
    res.writeHead(404)
    res.end('not found')
  })

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (socket) => {
    socket.on('message', (data) => socket.send(`echo:${String(data)}`))
  })
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/api/remote.mux') wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req))
    else socket.destroy()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    state,
    async close() {
      wss.clients.forEach((client) => client.terminate())
      wss.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function setCookieValue(response: Response, name: string): string | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const values = headers.getSetCookie?.() ?? (response.headers.get('set-cookie') === null ? [] : [response.headers.get('set-cookie') as string])
  for (const raw of values) {
    const [pair] = raw.split(';')
    if (pair === undefined) continue
    const at = pair.indexOf('=')
    if (at === -1) continue
    if (pair.slice(0, at) === name) return pair.slice(at + 1)
  }
  return undefined
}

interface GatewayFixture {
  gateway: PocketGateway
  base: string
  close: () => Promise<void>
}

async function startGateway(overrides: Partial<ConstructorParameters<typeof PocketGateway>[0]> = {}): Promise<GatewayFixture> {
  const upstream = await startUpstream()
  const gateway = new PocketGateway({
    upstreamOrigin: () => upstream.origin,
    launchToken: () => 'process-token',
    bindHost: '127.0.0.1',
    port: 0,
    portAttempts: 1,
    cookieMaxAgeDays: 30,
    pairing: { ttlSeconds: 300, maxAttempts: 10, windowSeconds: 300, lockoutSeconds: 900 },
    secret: createSecret(),
    rotateSecret: async () => createSecret(),
    version: 'test',
    ...overrides,
  })
  await gateway.start()
  return {
    gateway,
    base: `http://127.0.0.1:${String(gateway.port)}`,
    async close() {
      await gateway.close()
      await upstream.close()
    },
  }
}

async function pair(fixture: GatewayFixture): Promise<string> {
  const response = await fetch(`${fixture.base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: fixture.gateway.pairing.code }),
  })
  expect(response.status).toBe(204)
  const value = setCookieValue(response, GATEWAY_COOKIE)
  expect(value).toBeDefined()
  return value as string
}

const fixtures: GatewayFixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(async (fixture) => await fixture.close()))
})

describe('PocketGateway request flow', () => {
  it('serves the pairing page unauthenticated and the app only after a cookie', async () => {
    const fixture = await startGateway()
    fixtures.push(fixture)

    const page = await fetch(`${fixture.base}/pair`)
    expect(page.status).toBe(200)
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(await page.text()).toContain('Pairing code')

    const anonymous = await fetch(`${fixture.base}/`, { redirect: 'manual', headers: { accept: 'text/html' } })
    expect(anonymous.status).toBe(303)
    expect(anonymous.headers.get('location')).toBe('/pair')

    const api = await fetch(`${fixture.base}/api/echo`)
    expect(api.status).toBe(401)

    const cookie = await pair(fixture)
    const first = await fetch(`${fixture.base}/`, {
      redirect: 'manual',
      headers: { accept: 'text/html', cookie: `${GATEWAY_COOKIE}=${cookie}` },
    })
    expect(first.status).toBe(303)
    expect(first.headers.get('location')).toBe('/?token=process-token')

    const exchange = await fetch(`${fixture.base}/?token=process-token`, {
      redirect: 'manual',
      headers: { accept: 'text/html', cookie: `${GATEWAY_COOKIE}=${cookie}` },
    })
    expect(exchange.status).toBe(303)
    expect(exchange.headers.get('location')).toBe('./')
    const upstreamName = upstreamCookieName(fixture.gateway.info().upstreamOrigin)
    expect(setCookieValue(exchange, upstreamName)).toBe('ok')

    const app = await fetch(`${fixture.base}/`, {
      redirect: 'manual',
      headers: { accept: 'text/html', cookie: `${GATEWAY_COOKIE}=${cookie}; ${upstreamName}=ok` },
    })
    expect(app.status).toBe(200)
    expect(await app.text()).toContain('app-shell')
  })

  it('rewrites the upstream Host, strips browser provenance, and proxies API calls', async () => {
    const fixture = await startGateway()
    fixtures.push(fixture)
    const cookie = await pair(fixture)
    const response = await fetch(`${fixture.base}/api/echo`, {
      headers: {
        cookie: `${GATEWAY_COOKIE}=${cookie}`,
        origin: fixture.base,
        'sec-fetch-site': 'same-origin',
      },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { headers: Record<string, string> }
    expect(body.headers.host).toMatch(/^127\.0\.0\.1:\d+$/u)
    expect(body.headers.origin).toBeUndefined()
    expect(body.headers['sec-fetch-site']).toBeUndefined()
    expect(body.headers['x-forwarded-for']).toBeUndefined()
  })

  it('rejects state-changing requests from another origin', async () => {
    const fixture = await startGateway()
    fixtures.push(fixture)
    const cookie = await pair(fixture)
    const response = await fetch(`${fixture.base}/api/echo`, {
      method: 'POST',
      headers: {
        cookie: `${GATEWAY_COOKIE}=${cookie}`,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    })
    expect(response.status).toBe(403)
  })

  it('heals an expired upstream session through the launch token', async () => {
    const fixture = await startGateway()
    fixtures.push(fixture)
    const cookie = await pair(fixture)
    const name = upstreamCookieName(fixture.gateway.info().upstreamOrigin)
    const stale = await fetch(`${fixture.base}/`, {
      redirect: 'manual',
      headers: { accept: 'text/html', cookie: `${GATEWAY_COOKIE}=${cookie}; ${name}=stale` },
    })
    expect(stale.status).toBe(303)
    expect(stale.headers.get('location')).toBe('/?token=process-token')
  })

  it('does not expose the loopback control routes through the gateway', async () => {
    const fixture = await startGateway()
    fixtures.push(fixture)
    const cookie = await pair(fixture)
    for (const path of ['/pocket/info', '/pocket/revoke', '/pocket/refresh']) {
      const response = await fetch(`${fixture.base}${path}`, { headers: { cookie: `${GATEWAY_COOKIE}=${cookie}` } })
      expect(response.status).toBe(404)
    }
  })

  it('proxies the mux WebSocket only with a valid gateway cookie', async () => {
    const fixture = await startGateway()
    fixtures.push(fixture)
    const cookie = await pair(fixture)

    const socket = new WebSocket(`ws://127.0.0.1:${String(fixture.gateway.port)}/api/remote.mux`, {
      headers: { cookie: `${GATEWAY_COOKIE}=${cookie}` },
    })
    await once(socket, 'open')
    socket.send('hello')
    const [message] = await once(socket, 'message')
    expect(String(message)).toBe('echo:hello')
    socket.close()
    await once(socket, 'close')

    const denied = await new Promise<number>((resolve) => {
      const client = new WebSocket(`ws://127.0.0.1:${String(fixture.gateway.port)}/api/remote.mux`)
      client.on('unexpected-response', (_request, response) => {
        resolve(response.statusCode ?? 0)
        client.terminate()
      })
      client.on('error', () => resolve(0))
      setTimeout(() => {
        client.terminate()
        resolve(0)
      }, 1500)
    })
    expect(denied).toBe(401)
  })

  it('invalidates device cookies on revoke', async () => {
    const fixture = await startGateway()
    fixtures.push(fixture)
    const cookie = await pair(fixture)
    await fixture.gateway.revoke()
    const response = await fetch(`${fixture.base}/`, {
      redirect: 'manual',
      headers: { accept: 'text/html', cookie: `${GATEWAY_COOKIE}=${cookie}` },
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/pair')
  })

  it('locks pairing after repeated wrong codes', async () => {
    const fixture = await startGateway({
      pairing: { ttlSeconds: 300, maxAttempts: 2, windowSeconds: 300, lockoutSeconds: 900 },
    })
    fixtures.push(fixture)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${fixture.base}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: '000000' }),
      })
      expect(response.status).toBe(401)
    }
    const locked = await fetch(`${fixture.base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: fixture.gateway.pairing.code }),
    })
    expect(locked.status).toBe(429)
  })
})

describe('PocketGateway listener lifecycle', () => {
  it('falls back to the next port when the first is occupied', async () => {
    const blockedPort = await freePort()
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(blockedPort, '127.0.0.1', resolve))
    const fixture = await startGateway({ port: blockedPort, portAttempts: 3 })
    fixtures.push(fixture)
    expect(fixture.gateway.port).toBeGreaterThan(blockedPort)
    expect(fixture.gateway.state).toBe('running')
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  })

  it('serves HTTPS from supplied PEM material', async () => {
    const pems = selfsigned.generate([{ name: 'commonName', value: '127.0.0.1' }], { days: 1, keySize: 2048 })
    const fixture = await startGateway({ tls: { cert: pems.cert, key: pems.private } })
    fixtures.push(fixture)
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpsRequest(
        { host: '127.0.0.1', port: fixture.gateway.port, path: '/healthz', rejectUnauthorized: false },
        (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        },
      )
      request.on('error', reject)
      request.end()
    })
    expect(status).toBe(200)
    expect(fixture.gateway.info().protocol).toBe('https:')
    expect(fixture.gateway.info().tls).toBe(true)
  })

  it('reports a contained error when no port binds', async () => {
    const port = await freePort()
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve))
    const gateway = new PocketGateway({
      upstreamOrigin: () => 'http://127.0.0.1:1',
      launchToken: () => 'token',
      bindHost: '127.0.0.1',
      port,
      portAttempts: 1,
      cookieMaxAgeDays: 30,
      pairing: { ttlSeconds: 300, maxAttempts: 10, windowSeconds: 300, lockoutSeconds: 900 },
      secret: createSecret(),
      rotateSecret: async () => createSecret(),
      version: 'test',
    })
    await expect(gateway.start()).rejects.toBeTruthy()
    expect(gateway.state).toBe('error')
    expect(gateway.info().status).toBe('error')
    expect(gateway.info().error).toContain('Cannot bind')
    await gateway.close()
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  })
})
