/**
 * Typed calls to the loopback-only control routes the desktop dialog uses.
 * Every request is same-origin and carries the app's own session cookie.
 */
import type { PocketInfo, RevokeResult } from '../shared/types.ts'

/** Failure carrying the HTTP status so the dialog can say what to do next. */
export class PocketApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'PocketApiError'
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
    })
  } catch (error) {
    throw new PocketApiError(0, `Cannot reach DeepSeek Harness (${String(error)})`)
  }
  if (!response.ok) {
    let message = `Request failed (${String(response.status)})`
    try {
      const body = (await response.json()) as { message?: unknown }
      if (typeof body.message === 'string' && body.message !== '') message = body.message
    } catch {
      /* plain text or empty body */
    }
    throw new PocketApiError(response.status, message)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** The three control operations the dialog needs. */
export const pocketApi = {
  info: (): Promise<PocketInfo> => request<PocketInfo>('/pocket/info'),
  refresh: (): Promise<PocketInfo> => request<PocketInfo>('/pocket/refresh', { method: 'POST' }),
  revoke: (): Promise<RevokeResult> => request<RevokeResult>('/pocket/revoke', { method: 'POST' }),
}
