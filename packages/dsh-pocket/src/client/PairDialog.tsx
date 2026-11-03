/**
 * The desktop pairing dialog: a QR code, the short-lived code, the reachable
 * addresses, and the two control actions (new code, revoke devices).
 *
 * It talks only to the loopback control routes, so it works from the desktop
 * window and never from a paired phone (the gateway answers `/pocket/*` with
 * 404).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PocketInfo } from '../shared/types.ts'
import { PocketApiError, pocketApi } from './api.ts'
import { QrCode } from './qr.tsx'

/** Props the sidebar action passes in. */
export interface PairDialogProps {
  onClose: () => void
}

function usableOrigins(info: PocketInfo): string[] {
  const loopback = /^https?:\/\/(127\.0\.0\.1|localhost)(?::|\/|$)/u
  const usable = info.origins.filter((origin) => !loopback.test(origin))
  return usable.length > 0 ? usable : info.origins
}

function describeError(error: unknown): string {
  if (error instanceof PocketApiError) {
    if (error.status === 401 || error.status === 403) {
      return 'The desktop session is not authorized for this request. Reload the DeepSeek Harness window and try again.'
    }
    if (error.status === 404) {
      return 'This page is served through the remote gateway. Open the DeepSeek Harness desktop window to pair a device.'
    }
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${String(minutes)}:${String(rest).padStart(2, '0')}`
}

/** The modal itself. */
export function PairDialog({ onClose }: PairDialogProps): React.JSX.Element {
  const [info, setInfo] = useState<PocketInfo | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [selectedOrigin, setSelectedOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const mounted = useRef(true)
  const modalRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const autoRefreshedFor = useRef(0)
  const previousFocus = useRef<Element | null>(null)

  const load = useCallback(async (rotate: boolean): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const next = rotate ? await pocketApi.refresh() : await pocketApi.info()
      if (!mounted.current) return
      setInfo(next)
      const choices = usableOrigins(next)
      setSelectedOrigin((current) => (choices.includes(current) ? current : (choices[0] ?? '')))
    } catch (failure) {
      if (!mounted.current) return
      setError(describeError(failure))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    previousFocus.current = document.activeElement
    // Rotating on open means the visible code is always fresh and the previous
    // one cannot be replayed from a screenshot taken earlier.
    void load(true)
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    window.setTimeout(() => closeRef.current?.focus(), 30)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus()
    }
  }, [load])

  const pairing = info?.pairing
  useEffect(() => {
    if (pairing === undefined || info?.status !== 'running') return
    if (pairing.expiresAt > Date.now()) return
    if (autoRefreshedFor.current === pairing.expiresAt) return
    autoRefreshedFor.current = pairing.expiresAt
    void load(true)
  }, [pairing, info?.status, load])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const root = modalRef.current
      if (root === null) return
      const focusable = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    },
    [onClose],
  )

  const choices = useMemo(() => {
    if (info === undefined) return []
    return usableOrigins(info)
  }, [info])

  const origin = selectedOrigin !== '' && choices.includes(selectedOrigin) ? selectedOrigin : (choices[0] ?? '')
  const code = pairing?.code ?? ''
  const pairUrl = origin !== '' && code !== '' ? `${origin}/pair#${code}` : ''
  const secondsLeft = pairing === undefined ? 0 : Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000))

  const copy = async (): Promise<void> => {
    if (pairUrl === '') return
    try {
      await navigator.clipboard.writeText(pairUrl)
      setCopied(true)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = pairUrl
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.append(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
      } catch {
        /* nothing else to try */
      } finally {
        textarea.remove()
      }
    }
    window.setTimeout(() => setCopied(false), 1500)
  }

  const revoke = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await pocketApi.revoke()
      setConfirmRevoke(false)
      await load(true)
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      setBusy(false)
    }
  }

  const running = info?.status === 'running'
  const noAddress = info !== undefined && info.addresses.length === 0

  return (
    <div
      className="pocket-modal-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="pocket-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pocket-dialog-title"
        ref={modalRef}
        onKeyDown={onKeyDown}
      >
        <div className="pocket-modal__head">
          <div className="pocket-modal__title" id="pocket-dialog-title">
            Link phone
          </div>
          <button ref={closeRef} type="button" className="pocket-icon-btn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>

        <p className="pocket-modal__sub">
          Scan this code with your phone&apos;s camera. Both devices must be on the same network.
        </p>

        {loading && info === undefined ? <div className="pocket-spinner">Preparing the gateway…</div> : null}

        {error !== undefined ? (
          <div className="pocket-notice pocket-notice--warn" role="alert">
            {error}
          </div>
        ) : null}

        {info?.status === 'disabled' ? (
          <div className="pocket-notice">
            Remote access is disabled in this profile. Set <code>enabled: true</code> on the <code>dsh-pocket</code> row in the
            profile patch, then restart DeepSeek Harness.
          </div>
        ) : null}

        {info?.status === 'error' ? (
          <div className="pocket-notice pocket-notice--warn">
            The gateway could not start{info.error === undefined ? '.' : `: ${info.error}`}
          </div>
        ) : null}

        {info?.status === 'starting' ? <div className="pocket-notice">The gateway is still starting…</div> : null}

        {running ? (
          <>
            {noAddress ? (
              <div className="pocket-notice pocket-notice--warn">
                No LAN address was found. Connect this Mac to Wi-Fi or Ethernet, then reopen this dialog.
              </div>
            ) : null}

            {pairUrl !== '' ? <QrCode text={pairUrl} /> : null}

            {code !== '' ? (
              <>
                <div className="pocket-code" aria-label={`Pairing code ${code}`}>
                  {code}
                </div>
                <div className="pocket-countdown">
                  {secondsLeft > 0 ? `Code expires in ${formatCountdown(secondsLeft)}` : 'Refreshing the code…'}
                </div>
              </>
            ) : null}

            {choices.length > 1 ? (
              <select
                className="pocket-select"
                aria-label="Connection address"
                value={origin}
                onChange={(event) => setSelectedOrigin(event.target.value)}
              >
                {choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            ) : null}

            {pairUrl !== '' ? (
              <code className="pocket-url">{pairUrl}</code>
            ) : null}

            <div className="pocket-actions">
              <button type="button" className="pocket-btn pocket-btn--primary" onClick={() => void copy()} disabled={pairUrl === ''}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button type="button" className="pocket-btn" onClick={() => void load(true)} disabled={busy || loading}>
                New code
              </button>
              <button type="button" className="pocket-btn pocket-btn--danger" onClick={() => setConfirmRevoke(true)} disabled={busy}>
                Revoke devices
              </button>
            </div>

            {confirmRevoke ? (
              <div className="pocket-notice pocket-notice--warn" role="alert">
                <div style={{ marginBottom: 10 }}>
                  Revoke every paired device? Phones and tablets must scan a new code to reconnect.
                </div>
                <div className="pocket-actions">
                  <button type="button" className="pocket-btn" onClick={() => setConfirmRevoke(false)} disabled={busy}>
                    Cancel
                  </button>
                  <button type="button" className="pocket-btn pocket-btn--danger" onClick={() => void revoke()} disabled={busy}>
                    {busy ? 'Revoking…' : 'Revoke all'}
                  </button>
                </div>
              </div>
            ) : null}

            <p className="pocket-note">
              Served only on your local network{info?.tls === true ? ' over TLS' : ' over plain HTTP'}. A device stays paired for 30
              days and can be revoked here at any time. Keep DeepSeek Harness open while you use it remotely.
            </p>
          </>
        ) : null}

        {info !== undefined && !running && !loading ? (
          <div className="pocket-actions" style={{ marginTop: 12 }}>
            <button type="button" className="pocket-btn" onClick={() => void load(false)}>
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
