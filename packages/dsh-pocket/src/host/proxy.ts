/**
 * The loopback proxy behind the gateway.
 *
 * The DSH trust fence wants a loopback Host, no cross-site Origin, and its own
 * signed cookie. The phone speaks to the gateway origin, so this layer rewrites
 * the Host, drops browser provenance headers, and forwards cookies untouched.
 * It also owns the transparent re-exchange when the upstream cookie is missing
 * or expired, which is what makes a desktop restart invisible to a paired
 * device.
 */
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import * as httpProxyModule from 'http-proxy'

/** Minimal logger surface compatible with the Cordis logger. */
export interface ProxyLogger {
  warn(message: string, ...args: unknown[]): void
}

/** Construction options for the upstream proxy. */
export interface UpstreamProxyOptions {
  /** Current loopback origin of the DSH web server. */
  upstreamOrigin: () => string
  /** The process launch token, minted by the DSH connection service. */
  launchToken: () => string
  logger?: ProxyLogger
}

/** The proxy face the gateway server uses. */
export interface UpstreamProxy {
  web(req: IncomingMessage, res: ServerResponse): void
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  close(): void
}

/** Structural view of the http-proxy instance we use. */
interface ProxyInstance {
  on(event: string, listener: (...args: any[]) => void): void
  web(req: IncomingMessage, res: ServerResponse, options?: Record<string, unknown>): void
  ws(req: IncomingMessage, socket: Duplex, head: Buffer, options?: Record<string, unknown>): void
  close(): void
}

type ProxyFactory = (options?: Record<string, unknown>) => ProxyInstance

const STRIPPED_REQUEST_HEADERS = [
  'origin',
  'referer',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
]

function proxyFactory(): ProxyFactory {
  const candidate = httpProxyModule as unknown as { createProxyServer?: ProxyFactory; default?: ProxyFactory }
  const factory = candidate.createProxyServer ?? candidate.default
  if (typeof factory !== 'function') throw new Error('dsh-pocket: http-proxy did not expose createProxyServer')
  return factory
}

function rewrite(proxyReq: ClientRequest, upstreamOrigin: string): void {
  try {
    const upstream = new URL(upstreamOrigin)
    proxyReq.setHeader('host', upstream.host)
    for (const header of STRIPPED_REQUEST_HEADERS) proxyReq.removeHeader(header)
  } catch {
    /* the proxy request is already gone */
  }
}

function parsePath(url: string | undefined): URL | undefined {
  try {
    return new URL(url ?? '/', 'http://gateway.invalid')
  } catch {
    return undefined
  }
}

function isDocumentNavigation(req: IncomingMessage): boolean {
  if (req.method !== 'GET') return false
  if (!String(req.headers.accept ?? '').includes('text/html')) return false
  const path = parsePath(req.url)?.pathname
  return path === '/' || path === '/index.html'
}

function acceptsHtml(req: IncomingMessage): boolean {
  return String(req.headers.accept ?? '').includes('text/html')
}

function isHtmlResponse(headers: Record<string, unknown>): boolean {
  return String(headers['content-type'] ?? '').includes('text/html')
}

/**
 * The DSH auth cookie is `SameSite=Strict`. A phone opening the PWA from its
 * home screen is a cross-site top-level navigation, so Strict cookies are not
 * sent and the login exchange loops. The gateway is the only client here, and
 * it enforces its own Origin/Sec-Fetch fence on state-changing requests, so the
 * upstream auth cookie can safely be relaxed to Lax.
 */
function relaxSameSite(headers: Record<string, string | string[] | number | undefined>): void {
  const cookies = headers['set-cookie']
  if (cookies === undefined) return
  const values = Array.isArray(cookies) ? cookies : [String(cookies)]
  headers['set-cookie'] = values.map((cookie) => cookie.replace(/;\s*SameSite=Strict/giu, '; SameSite=Lax'))
}

/** Build the proxying layer. */
export function createUpstreamProxy(options: UpstreamProxyOptions): UpstreamProxy {
  const proxy = proxyFactory()({
    ws: true,
    changeOrigin: false,
    xfwd: false,
    selfHandleResponse: true,
    proxyTimeout: 0,
    timeout: 0,
  })

  const target = (): string => options.upstreamOrigin()

  proxy.on('proxyReq', (proxyReq: ClientRequest) => rewrite(proxyReq, target()))
  proxy.on('proxyReqWs', (proxyReq: ClientRequest) => rewrite(proxyReq, target()))

  proxy.on('proxyRes', (proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse) => {
    const status = proxyRes.statusCode ?? 502
    const url = parsePath(req.url)
    const hasToken = url?.searchParams.has('token') === true

    if (status === 401 && isDocumentNavigation(req) && !hasToken) {
      let token: string | undefined
      try {
        token = options.launchToken()
      } catch (error) {
        options.logger?.warn(`dsh-pocket: cannot mint an upstream launch token (${String(error)})`)
      }
      if (token !== undefined && token !== '') {
        proxyRes.resume()
        res.writeHead(303, {
          location: `/?token=${encodeURIComponent(token)}`,
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        })
        res.end()
        return
      }
    }

    const headers: Record<string, string | string[] | number | undefined> = {}
    for (const [name, value] of Object.entries(proxyRes.headers)) {
      if (value === undefined) continue
      if (HOP_BY_HOP.has(name.toLowerCase())) continue
      headers[name] = value
    }
    if (headers['x-content-type-options'] === undefined) headers['x-content-type-options'] = 'nosniff'
    if (isHtmlResponse(headers) && headers['x-frame-options'] === undefined) headers['x-frame-options'] = 'SAMEORIGIN'
    relaxSameSite(headers)
    res.writeHead(status, headers)
    proxyRes.pipe(res)
    proxyRes.on('error', () => res.destroy())
    res.on('close', () => proxyRes.destroy())
  })

  proxy.on('error', (error: Error, req: IncomingMessage, res: ServerResponse | Duplex) => {
    options.logger?.warn(`dsh-pocket: upstream proxy error (${String(error)})`)
    if (res !== undefined && typeof (res as ServerResponse).writeHead === 'function') {
      const response = res as ServerResponse
      if (response.headersSent) {
        response.destroy()
        return
      }
      const wantsHtml = req !== undefined && acceptsHtml(req)
      response.writeHead(502, {
        'content-type': wantsHtml ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      response.end(
        wantsHtml
          ? '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeepSeek Harness unavailable</title><body style="font:16px -apple-system,sans-serif;padding:24px"><h1>Harness unavailable</h1><p>The desktop app is not reachable right now. Keep DeepSeek Harness open on your Mac, then try again.</p></body>'
          : JSON.stringify({ error: 'upstream-unavailable' }),
      )
      return
    }
    if (res !== undefined && typeof (res as Duplex).destroy === 'function') (res as Duplex).destroy()
  })

  return {
    web(req, res) {
      proxy.web(req, res, { target: target(), secure: false })
    },
    upgrade(req, socket, head) {
      proxy.ws(req, socket, head, { target: target(), secure: false })
    },
    close() {
      try {
        proxy.close()
      } catch {
        /* already closed */
      }
    },
  }
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
