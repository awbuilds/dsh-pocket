/**
 * The LAN gateway.
 *
 * It owns its own listener, its own pairing code and device cookie, and a
 * loopback proxy into the running DSH web server. The DSH server is never
 * rebound: it stays on loopback, and this process is the only thing the phone
 * can reach. Every failure here is contained — the desktop app keeps running
 * even when no gateway port can bind.
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { Duplex } from 'node:stream'
import type { PairError, PocketInfo, PocketStatus } from '../shared/types.ts'
import { listLanAddresses, originsFor } from './addresses.ts'
import {
  GATEWAY_COOKIE,
  PairingCodes,
  RateLimiter,
  SessionCookies,
  parseCookieHeader,
  upstreamCookieName,
  type PairingSnapshot,
} from './gateway-auth.ts'
import { renderPairPage } from './pair-page.ts'
import { createUpstreamProxy } from './proxy.ts'
import { ICON_ROUTES, MANIFEST_PATH, readIcon, renderManifest } from './pwa.ts'

/** Minimal logger surface compatible with the Cordis logger. */
export interface GatewayLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/** PEM material for the optional TLS listener. */
export interface GatewayTls {
  cert: string | Buffer
  key: string | Buffer
}

/** Pairing policy supplied by the plugin config. */
export interface GatewayPairingOptions {
  ttlSeconds: number
  maxAttempts: number
  windowSeconds: number
  lockoutSeconds: number
}

/** Construction options for one gateway. */
export interface GatewayOptions {
  /** Current loopback origin of the DSH web server. */
  upstreamOrigin: () => string
  /** Mint the process launch token used for the upstream cookie exchange. */
  launchToken: () => string
  bindHost: string
  port: number
  portAttempts: number
  tls?: GatewayTls
  cookieMaxAgeDays: number
  pairing: GatewayPairingOptions
  extraOrigins?: string[]
  secret: Buffer
  /** Persist and return a new gateway secret. */
  rotateSecret: () => Promise<Buffer>
  version: string
  logger?: GatewayLogger
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const MAX_PAIR_BODY_BYTES = 2048
const PAIR_LIMIT_PER_MINUTE = 30

function log(options: { logger?: GatewayLogger }, level: keyof GatewayLogger, message: string): void {
  options.logger?.[level](message)
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown'
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

function sendText(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, {
    location,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end()
}

function acceptsHtml(req: IncomingMessage): boolean {
  return String(req.headers.accept ?? '').includes('text/html')
}

function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    let done = false
    const finish = (value: unknown): void => {
      if (done) return
      done = true
      resolve(value)
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > limit) {
        req.destroy()
        finish(undefined)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        finish(undefined)
        return
      }
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        finish(undefined)
      }
    })
    req.on('error', () => finish(undefined))
  })
}

function writeSocketReject(socket: Duplex, status: number, message: string): void {
  try {
    socket.end(`HTTP/1.1 ${String(status)} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  } catch {
    socket.destroy()
  }
}

function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

/** One running (or failed) gateway instance. */
export class PocketGateway {
  readonly #options: GatewayOptions
  readonly #codes: PairingCodes
  readonly #cookies: SessionCookies
  readonly #limiter = new RateLimiter(PAIR_LIMIT_PER_MINUTE, 60_000)
  readonly #proxy: ReturnType<typeof createUpstreamProxy>
  readonly #sockets = new Set<Duplex>()
  #server: Server | undefined
  #port = 0
  #protocol: 'http:' | 'https:'
  #state: PocketStatus = 'starting'
  #error: string | undefined
  #startedAt = 0
  #closed = false

  constructor(options: GatewayOptions) {
    this.#options = options
    this.#protocol = options.tls === undefined ? 'http:' : 'https:'
    this.#codes = new PairingCodes(options.pairing)
    this.#cookies = new SessionCookies(options.secret, options.cookieMaxAgeDays)
    this.#proxy = createUpstreamProxy({
      upstreamOrigin: options.upstreamOrigin,
      launchToken: options.launchToken,
      logger: options.logger,
    })
  }

  /** Listener state. */
  get state(): PocketStatus {
    return this.#state
  }

  /** Listening port, or 0 before bind. */
  get port(): number {
    return this.#port
  }

  /** Listener protocol. */
  get protocol(): 'http:' | 'https:' {
    return this.#protocol
  }

  /** Failure text for the dialog, when state is `error`. */
  get error(): string | undefined {
    return this.#error
  }

  /** Current pairing code. */
  get pairing(): PairingSnapshot {
    return this.#codes.current()
  }

  /** Bind the listener, trying the configured port range. */
  async start(): Promise<void> {
    if (this.#closed) throw new Error('dsh-pocket: gateway is already closed')
    const attempts = this.#options.port === 0 ? 1 : Math.max(1, this.#options.portAttempts)
    let lastError: unknown
    for (let index = 0; index < attempts; index += 1) {
      if (this.#closed) return
      const port = this.#options.port === 0 ? 0 : this.#options.port + index
      const server = this.#createServer()
      try {
        await listen(server, port, this.#options.bindHost)
        if (this.#closed) {
          await closeServer(server)
          return
        }
        this.#server = server
        this.#port = listenerPort(server)
        this.#state = 'running'
        this.#error = undefined
        this.#startedAt = Date.now()
        log(this.#options, 'info', `gateway listening on ${this.origins().join(', ')}`)
        return
      } catch (error) {
        lastError = error
        await closeServer(server)
        const code = (error as NodeJS.ErrnoException).code
        if (this.#options.port === 0 || (code !== 'EADDRINUSE' && code !== 'EACCES')) break
        log(this.#options, 'warn', `dsh-pocket: port ${String(port)} unavailable (${String(code)}), trying the next one`)
      }
    }
    this.#state = 'error'
    this.#error =
      lastError instanceof Error
        ? `Cannot bind ${this.#options.bindHost}:${String(this.#options.port)} — ${lastError.message}`
        : `Cannot bind ${this.#options.bindHost}:${String(this.#options.port)}`
    log(this.#options, 'error', this.#error)
    throw lastError instanceof Error ? lastError : new Error(this.#error)
  }

  /** Close the listener and every proxied socket. */
  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#state = 'disabled'
    this.#codes.dispose()
    this.#proxy.close()
    for (const socket of this.#sockets) {
      try {
        socket.destroy()
      } catch {
        /* already gone */
      }
    }
    this.#sockets.clear()
    const server = this.#server
    this.#server = undefined
    if (server === undefined) return
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000)
      timer.unref?.()
      server.close(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Rotate the pairing code and return the new snapshot. */
  refreshCode(): PairingSnapshot {
    return this.#codes.rotate()
  }

  /** Rotate the device-cookie secret, invalidating every paired device. */
  async revoke(): Promise<number> {
    const secret = await this.#options.rotateSecret()
    this.#cookies.rotate(secret)
    this.#codes.rotate()
    return Date.now()
  }

  /** LAN addresses the gateway is reachable at, primary first. */
  addresses(): string[] {
    const bind = this.#options.bindHost
    if (bind !== '0.0.0.0' && bind !== '::') return [bind]
    return listLanAddresses()
  }

  /** Complete origin list for the dialog and CSRF checks. */
  origins(): string[] {
    const port = this.#port || this.#options.port
    const protocol = this.#protocol
    const list = originsFor(protocol, this.addresses(), port)
    const extras = (this.#options.extraOrigins ?? [])
      .map((origin) => normalizeOrigin(origin))
      .filter((origin): origin is string => origin !== undefined)
    const loopback = [`${protocol}//127.0.0.1:${String(port)}`, `${protocol}//localhost:${String(port)}`]
    const seen = new Set<string>()
    const result: string[] = []
    for (const origin of [...list, ...extras, ...loopback]) {
      if (seen.has(origin)) continue
      seen.add(origin)
      result.push(origin)
    }
    return result
  }

  /** Snapshot for `GET /pocket/info`. */
  info(): PocketInfo {
    return {
      status: this.#state,
      protocol: this.#protocol,
      port: this.#port,
      addresses: this.addresses(),
      origins: this.origins(),
      pairing: this.#codes.current(),
      upstreamOrigin: this.#upstreamOrigin(),
      tls: this.#options.tls !== undefined,
      error: this.#error,
      version: this.#options.version,
    }
  }

  /** Milliseconds since the listener bound. */
  get uptimeMs(): number {
    return this.#startedAt === 0 ? 0 : Date.now() - this.#startedAt
  }

  #upstreamOrigin(): string {
    try {
      return this.#options.upstreamOrigin()
    } catch {
      return ''
    }
  }

  #createServer(): Server {
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      void this.#handleRequest(req, res)
    }
    const server =
      this.#options.tls === undefined
        ? createHttpServer(handler)
        : createHttpsServer({ cert: this.#options.tls.cert, key: this.#options.tls.key }, handler)

    server.on('connection', (socket) => {
      this.#sockets.add(socket)
      socket.on('close', () => this.#sockets.delete(socket))
    })
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.#handleUpgrade(req, socket, head)
    })
    server.on('clientError', (_error, socket) => {
      try {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      } catch {
        socket.destroy()
      }
    })
    return server
  }

  async #handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://gateway.invalid')
    } catch {
      sendText(res, 400, 'bad request')
      return
    }

    try {
      if (url.pathname === '/healthz') {
        sendJson(res, 200, { ok: true, state: this.#state, port: this.#port, protocol: this.#protocol })
        return
      }

      if (url.pathname === '/pair') {
        await this.#handlePair(req, res)
        return
      }

      // The upstream's loopback control routes must never be reachable from the LAN.
      if (url.pathname === '/pocket' || url.pathname.startsWith('/pocket/')) {
        sendText(res, 404, 'not found')
        return
      }

      if (url.pathname === MANIFEST_PATH || ICON_ROUTES[url.pathname] !== undefined) {
        await this.#servePwaAsset(url.pathname, res)
        return
      }

      const session = this.#cookieSession(req)
      if (session === undefined) {
        this.#unauthorized(req, res)
        return
      }

      if (isStateChanging(req.method) && !this.#originAllowed(req)) {
        sendText(res, 403, 'forbidden')
        return
      }

      if (this.#needsUpstreamLogin(req, url)) {
        const token = this.#launchToken()
        if (token === undefined) {
          sendText(res, 502, 'DeepSeek Harness is not ready yet. Keep the desktop app open and reload.')
          return
        }
        redirect(res, `/?token=${encodeURIComponent(token)}`)
        return
      }

      this.#proxy.web(req, res)
    } catch (error) {
      log(this.#options, 'error', `dsh-pocket: gateway request failed (${String(error)})`)
      if (!res.headersSent) sendText(res, 500, 'internal error')
      else res.destroy()
    }
  }

  async #handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.#originAllowed(req)) {
      sendText(res, 403, 'forbidden')
      return
    }
    const ip = clientIp(req)
    if (!this.#limiter.take(`pair:${ip}`)) {
      const body: PairError = { error: 'rate-limited', message: 'Too many attempts. Wait a minute and try again.' }
      sendJson(res, 429, body)
      return
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      })
      res.end(renderPairPage())
      return
    }
    if (req.method !== 'POST') {
      sendText(res, 405, 'method not allowed')
      return
    }

    const body = await readJson(req, MAX_PAIR_BODY_BYTES)
    if (body === undefined || typeof body !== 'object' || body === null) {
      sendJson(res, 400, { error: 'bad-request', message: 'Send a JSON body with a code.' } satisfies PairError)
      return
    }
    const result = this.#codes.verify((body as { code?: unknown }).code, ip)
    if (!result.ok) {
      if (result.reason === 'locked') {
        sendJson(res, 429, {
          error: 'locked',
          message: 'Too many wrong codes. Wait a few minutes, then ask the Mac for a new code.',
        } satisfies PairError)
        return
      }
      if (result.reason === 'expired') {
        sendJson(res, 401, { error: 'expired', message: 'That code expired. Ask the Mac for a fresh code.' } satisfies PairError)
        return
      }
      sendJson(res, 401, { error: 'invalid', message: 'That code is wrong. Check the six digits on the Mac.' } satisfies PairError)
      return
    }

    const issued = this.#cookies.issue()
    res.writeHead(204, {
      'set-cookie': this.#cookies.cookieHeader(issued.value, issued.expiresAt, this.#protocol === 'https:'),
      'cache-control': 'no-store',
    })
    res.end()
  }

  async #servePwaAsset(pathname: string, res: ServerResponse): Promise<void> {
    if (pathname === MANIFEST_PATH) {
      sendText(res, 200, renderManifest(), 'application/manifest+json; charset=utf-8')
      return
    }
    const asset = ICON_ROUTES[pathname]
    if (asset === undefined) {
      sendText(res, 404, 'not found')
      return
    }
    try {
      const bytes = await readIcon(asset)
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(bytes.byteLength),
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      })
      res.end(bytes)
    } catch {
      sendText(res, 404, 'not found')
    }
  }

  #handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://gateway.invalid')
    } catch {
      writeSocketReject(socket, 400, 'Bad Request')
      return
    }
    if (url.pathname !== '/api/remote.mux') {
      writeSocketReject(socket, 404, 'Not Found')
      return
    }
    if (this.#cookieSession(req) === undefined) {
      writeSocketReject(socket, 401, 'Unauthorized')
      return
    }
    if (!this.#originAllowed(req)) {
      writeSocketReject(socket, 403, 'Forbidden')
      return
    }
    this.#proxy.upgrade(req, socket, head)
  }

  #cookieSession(req: IncomingMessage): string | undefined {
    const cookie = parseCookieHeader(req.headers.cookie)[GATEWAY_COOKIE]
    const payload = this.#cookies.verify(cookie)
    return payload?.sid
  }

  #originAllowed(req: IncomingMessage): boolean {
    if (String(req.headers['sec-fetch-site'] ?? '') === 'cross-site') return false
    const origin = req.headers.origin
    if (origin === undefined) return true
    const normalized = normalizeOrigin(Array.isArray(origin) ? origin[0] ?? '' : origin)
    if (normalized === undefined) return false
    return this.origins().includes(normalized)
  }

  #needsUpstreamLogin(req: IncomingMessage, url: URL): boolean {
    if (req.method !== 'GET' || !acceptsHtml(req)) return false
    if (url.pathname !== '/') return false
    if (url.searchParams.has('token')) return false
    const upstream = this.#upstreamOrigin()
    if (upstream === '') return false
    try {
      const cookieName = upstreamCookieName(upstream)
      return parseCookieHeader(req.headers.cookie)[cookieName] === undefined
    } catch {
      return false
    }
  }

  #launchToken(): string | undefined {
    try {
      const token = this.#options.launchToken()
      return token === '' ? undefined : token
    } catch (error) {
      log(this.#options, 'warn', `dsh-pocket: cannot mint the upstream launch token (${String(error)})`)
      return undefined
    }
  }

  #unauthorized(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET' && acceptsHtml(req)) {
      redirect(res, '/pair')
      return
    }
    sendJson(res, 401, { error: 'unauthorized', message: 'Pair this device from DeepSeek Harness on the Mac.' })
  }
}

function isStateChanging(method: string | undefined): boolean {
  return method !== undefined && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function listenerPort(server: Server): number {
  const address = server.address()
  return typeof address === 'object' && address !== null ? address.port : 0
}

async function closeServer(server: Server): Promise<void> {
  try {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      setTimeout(resolve, 250).unref?.()
    })
  } catch {
    /* never bound */
  }
}
