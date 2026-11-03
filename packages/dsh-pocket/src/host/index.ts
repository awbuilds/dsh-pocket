/**
 * Cordis plugin entry for the host plane.
 *
 * It starts the LAN gateway after the web server and connection services are
 * ready, exposes the loopback-only control routes the desktop dialog uses, and
 * adds the mobile viewport metadata to the served index. A gateway failure is
 * reported through `GET /pocket/info`, never thrown: remote access is an
 * optional surface, and the desktop app must keep working without it.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { PocketInfo, RevokeDeviceResult, RevokeResult } from '../shared/types.ts'
import { isLoopbackAddress, isLoopbackHost } from './addresses.ts'
import { DeviceRegistry } from './devices.ts'
import { PocketGateway, type GatewayLogger } from './gateway.ts'
import { resolveDshHome, SecretStore, type CredentialsLike, type SecretLogger } from './secret.ts'
import { transformIndex } from './pwa.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-pocket'

/** Services that must exist before the gateway can mint upstream URLs. */
export const inject = ['webServer', 'connection']

const VERSION = '0.0.3'

/** Plugin configuration, validated by the Loader before `apply`. */
export interface PocketConfig {
  enabled: boolean
  port: number
  portAttempts: number
  bindHost: string
  cookieMaxAgeDays: number
  pairingTtlSeconds: number
  pairingMaxAttempts: number
  pairingWindowSeconds: number
  pairingLockoutSeconds: number
  publicOrigins: string[]
  tlsCertFile?: string
  tlsKeyFile?: string
}

/** Configuration schema exposed to the profile Loader. */
export const Config = z.object({
  enabled: z.boolean().default(true),
  port: z.natural().max(65535).default(7317),
  portAttempts: z.natural().max(100).default(10),
  bindHost: z.string().default('0.0.0.0'),
  cookieMaxAgeDays: z.natural().max(3650).default(30),
  pairingTtlSeconds: z.natural().max(3600).default(300),
  pairingMaxAttempts: z.natural().max(1000).default(10),
  pairingWindowSeconds: z.natural().max(86400).default(300),
  pairingLockoutSeconds: z.natural().max(86400).default(900),
  publicOrigins: z.array(String).default([]),
  tlsCertFile: z.string(),
  tlsKeyFile: z.string(),
})

interface PluginState {
  gateway?: PocketGateway
  disabledReason?: string
  error?: string
}

function resolveUpstreamOrigin(ctx: Context): string {
  const server = ctx.webServer as unknown as { getOrigin?: () => string; protocol?: string; port: number }
  if (typeof server.getOrigin === 'function') return server.getOrigin()
  return `${server.protocol ?? 'http:'}//127.0.0.1:${String(server.port)}`
}

/**
 * Mint a fresh upstream launch token.
 *
 * Do not cache this: the DSH web server consumes a launch token when it sets
 * the browser session cookie. Reusing a consumed token made a reopened phone
 * bounce between `/` and `/?token=…` (ERR_TOO_MANY_REDIRECTS) after its
 * session cookie was gone.
 */
function resolveLaunchToken(ctx: Context): string {
  const origin = resolveUpstreamOrigin(ctx)
  const authenticated = ctx.connection.authenticatedUrl(origin.endsWith('/') ? origin : `${origin}/`)
  const token = new URL(authenticated).searchParams.get('token')
  if (token === null || token === '') throw new Error('dsh-pocket: the connection service did not mint a launch token')
  return token
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

async function loadTls(config: PocketConfig): Promise<{ cert: string; key: string } | undefined> {
  const certFile = config.tlsCertFile
  const keyFile = config.tlsKeyFile
  if (certFile === undefined || certFile === '') {
    if (keyFile !== undefined && keyFile !== '') throw new Error('tlsKeyFile is set but tlsCertFile is not')
    return undefined
  }
  if (keyFile === undefined || keyFile === '') throw new Error('tlsCertFile is set but tlsKeyFile is not')
  try {
    const [cert, key] = await Promise.all([readFile(resolve(certFile), 'utf8'), readFile(resolve(keyFile), 'utf8')])
    return { cert, key }
  } catch (error) {
    throw new Error(`cannot read TLS material (${String(error)})`)
  }
}

function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
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

function fallbackInfo(
  status: PocketInfo['status'],
  ctx: Context,
  error: string | undefined,
  config: PocketConfig,
): PocketInfo {
  let upstream = ''
  try {
    upstream = resolveUpstreamOrigin(ctx)
  } catch {
    /* not ready yet */
  }
  return {
    status,
    protocol: 'http:',
    port: 0,
    addresses: [],
    origins: [],
    upstreamOrigin: upstream,
    tls: false,
    error,
    version: VERSION,
    devices: [],
  }
}

/**
 * Mount the gateway, the loopback control routes, and the index transform.
 * @param ctx - host plugin context.
 * @param config - validated plugin configuration.
 */
export async function apply(ctx: Context, config: PocketConfig): Promise<void> {
  const logger = (ctx as unknown as { logger?: (name: string) => GatewayLogger }).logger?.('dsh-pocket') ?? console
  const log = logger as unknown as GatewayLogger & SecretLogger
  const state: PluginState = {}

  const describe = (): PocketInfo => {
    if (state.gateway !== undefined) {
      try {
        return state.gateway.info()
      } catch (error) {
        return fallbackInfo('error', ctx, String(error), config)
      }
    }
    if (state.disabledReason !== undefined) return fallbackInfo('disabled', ctx, state.disabledReason, config)
    if (state.error !== undefined) return fallbackInfo('error', ctx, state.error, config)
    return fallbackInfo('starting', ctx, undefined, config)
  }

  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!isLoopbackAddress(req.socket.remoteAddress) || !isLoopbackHost(req.headers.host)) {
      sendText(res, 403, 'forbidden')
      return true
    }
    try {
      const rejection = ctx.connection.requestRejection({ headers: req.headers })
      if (rejection !== undefined) {
        sendText(res, rejection, rejection === 401 ? 'authentication required' : 'forbidden')
        return true
      }
    } catch (error) {
      log.warn(`dsh-pocket: request admission failed (${String(error)})`)
      sendText(res, 403, 'forbidden')
      return true
    }
    return false
  }

  const onInfo = (req: IncomingMessage, res: ServerResponse): void => {
    if (guard(req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'method not allowed')
      return
    }
    sendJson(res, 200, describe())
  }

  const onRefresh = (req: IncomingMessage, res: ServerResponse): void => {
    if (guard(req, res)) return
    if (req.method !== 'POST') {
      sendText(res, 405, 'method not allowed')
      return
    }
    req.resume()
    state.gateway?.refreshCode()
    sendJson(res, 200, describe())
  }

  const onRevoke = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (guard(req, res)) return
    if (req.method !== 'POST') {
      sendText(res, 405, 'method not allowed')
      return
    }
    req.resume()
    if (state.gateway === undefined) {
      sendText(res, 409, 'remote access is not running')
      return
    }
    try {
      const revokedAt = await state.gateway.revoke()
      const result: RevokeResult = { revokedAt }
      sendJson(res, 200, result)
    } catch (error) {
      log.error(`dsh-pocket: revoke failed (${String(error)})`)
      sendText(res, 500, 'revoke failed')
    }
  }

  const onRevokeDevice = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (guard(req, res)) return
    if (req.method !== 'POST') {
      sendText(res, 405, 'method not allowed')
      return
    }
    if (state.gateway === undefined) {
      sendText(res, 409, 'remote access is not running')
      return
    }
    const body = await readJsonBody(req, 1024)
    const id =
      typeof body === 'object' && body !== null && typeof (body as { id?: unknown }).id === 'string'
        ? (body as { id: string }).id
        : undefined
    if (id === undefined || id === '') {
      sendText(res, 400, 'send a JSON body with a device id')
      return
    }
    const result: RevokeDeviceResult = { removed: state.gateway.revokeDevice(id) }
    sendJson(res, 200, result)
  }

  const disposers: Array<() => void> = []
  disposers.push(ctx.webServer.register({ kind: 'exact', path: '/pocket/info', handler: onInfo }))
  disposers.push(ctx.webServer.register({ kind: 'exact', path: '/pocket/refresh', handler: onRefresh }))
  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/pocket/revoke',
      handler: (req, res) => {
        void onRevoke(req, res)
      },
    }),
  )
  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/pocket/devices/revoke',
      handler: (req, res) => {
        void onRevokeDevice(req, res)
      },
    }),
  )
  disposers.push(ctx.webServer.tapIndex(transformIndex))
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        /* route already gone */
      }
    }
    void state.gateway?.close()
  })

  if (!config.enabled) {
    state.disabledReason = 'Remote access is disabled in the dsh-pocket configuration.'
    return
  }

  let tls: { cert: string; key: string } | undefined
  try {
    tls = await loadTls(config)
  } catch (error) {
    state.error = String(error instanceof Error ? error.message : error)
    log.error(`dsh-pocket: ${state.error}`)
    return
  }

  let credentialKeyFactory: ((scope: string, id: string) => unknown) | undefined
  try {
    const credentialsModule = (await import('@deepseek-ai/dsh-credentials')) as {
      credentialKey?: (scope: string, id: string) => unknown
    }
    credentialKeyFactory = credentialsModule.credentialKey
  } catch {
    /* file fallback */
  }

  let secret: Buffer
  const store = new SecretStore(
    ctx.get('credentials') as CredentialsLike | undefined,
    resolveDshHome(),
    log,
    credentialKeyFactory,
  )
  try {
    secret = await store.load()
  } catch (error) {
    state.error = `cannot load the gateway secret (${String(error)})`
    log.error(`dsh-pocket: ${state.error}`)
    return
  }

  const devices = new DeviceRegistry(resolveDshHome(), log)
  const gateway = new PocketGateway({
    upstreamOrigin: () => resolveUpstreamOrigin(ctx),
    launchToken: () => resolveLaunchToken(ctx),
    bindHost: config.bindHost,
    port: Number(config.port),
    portAttempts: Number(config.portAttempts),
    tls,
    cookieMaxAgeDays: Number(config.cookieMaxAgeDays),
    pairing: {
      ttlSeconds: Number(config.pairingTtlSeconds),
      maxAttempts: Number(config.pairingMaxAttempts),
      windowSeconds: Number(config.pairingWindowSeconds),
      lockoutSeconds: Number(config.pairingLockoutSeconds),
    },
    extraOrigins: config.publicOrigins,
    secret,
    rotateSecret: async () => await store.rotate(),
    devices,
    version: VERSION,
    logger: log,
  })
  state.gateway = gateway

  try {
    await gateway.start()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    // The gateway keeps its own error state for `describe()`; the plugin itself stays mounted.
  }
}

export default { name, inject, Config, apply }
