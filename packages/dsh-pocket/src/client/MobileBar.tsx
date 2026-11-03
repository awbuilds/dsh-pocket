/**
 * Phone navigation: a `shell.bottom` bar plus two overlays. The bar replaces
 * the desktop rail, the sheet lists sessions, and the drawer reveals the real
 * sidebar (workspaces, settings, plugins) as an off-canvas panel.
 *
 * The component receives the framework's standard hooks from the slot renderer
 * and the Cordis client context from the plugin closure; everything it needs
 * for navigation is on one of those two.
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { setDrawerOpen as setDrawerAttribute, useMobile } from './mobile.ts'

/** Props injected by `index.tsx` on top of the slot's standard share. */
export interface MobileBarProps {
  ctx: any
  useSessions: (selector: (state: any) => any, equal?: (left: any, right: any) => boolean) => any
  useSessionStatus: (selector: (state: any) => any, equal?: (left: any, right: any) => boolean) => any
  usePanelInfo?: (selector: (state: any) => any, equal?: (left: any, right: any) => boolean) => any
  useWorkspaces?: (selector: (state: any) => any, equal?: (left: any, right: any) => boolean) => any
}

interface SessionRow {
  id: string
  displayTitle?: string
  title?: string
  running?: boolean
  updatedAt?: number
  blank?: boolean
  origin?: string
}

function formatRelative(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return ''
  const delta = Date.now() - timestamp
  if (delta < 0) return 'now'
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${String(days)}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${String(weeks)}w ago`
  return new Date(timestamp).toLocaleDateString()
}

function SessionsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <path d="M3.2 5.4h13.6M3.2 10h13.6M3.2 14.6h9.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function NewIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <path d="M10 4.2v11.6M4.2 10h11.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function MoreIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <circle cx="4.2" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <circle cx="15.8" cy="10" r="1.5" fill="currentColor" />
    </svg>
  )
}

/** The bar and its overlays. */
export function MobileBar({ ctx, useSessions, useSessionStatus }: MobileBarProps): React.JSX.Element | null {
  const mobile = useMobile()
  const list = useSessions((state: any) => state)
  const statuses = useSessionStatus((state: any) => state)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [drawerOpen, setDrawerOpenState] = useState(false)

  const rows: SessionRow[] = Array.isArray(list?.ids)
    ? (list.ids as string[]).map((id) => list.byId?.[id]).filter((row): row is SessionRow => row !== undefined)
    : []
  const recent = rows
    .filter((row) => row.origin !== 'subagent')
    .slice()
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .slice(0, 40)

  let pending = 0
  if (statuses instanceof Map) {
    for (const status of statuses.values()) {
      if ((status as { pendingInteraction?: unknown }).pendingInteraction !== undefined) pending += 1
    }
  }

  const closeDrawer = useCallback(() => {
    setDrawerAttribute(false)
    setDrawerOpenState(false)
    try {
      ctx.layout?.toggleSidebar?.()
    } catch {
      /* layout is gone */
    }
  }, [ctx])

  const openDrawer = useCallback(() => {
    setDrawerAttribute(true)
    setDrawerOpenState(true)
    try {
      ctx.layout?.toggleSidebar?.()
    } catch {
      setDrawerAttribute(false)
      setDrawerOpenState(false)
    }
  }, [ctx])

  useEffect(() => {
    if (!drawerOpen) return
    const sidebar = document.querySelector<HTMLElement>('[data-pocket-sidebar]')
    const onClick = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('button, a, [role="button"], [data-row-key]') === null) return
      window.setTimeout(() => closeDrawer(), 220)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeDrawer()
    }
    sidebar?.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey)
    return () => {
      sidebar?.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [drawerOpen, closeDrawer])

  useEffect(() => {
    if (!sheetOpen && !drawerOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [sheetOpen, drawerOpen])

  useEffect(() => {
    return () => {
      setDrawerAttribute(false)
    }
  }, [])

  if (!mobile) return null

  const openSession = (id: string): void => {
    setSheetOpen(false)
    try {
      ctx.uiWorkspace?.openSession?.(id)
    } catch {
      /* the host rejected the address */
    }
  }

  const startSession = (): void => {
    setSheetOpen(false)
    try {
      ctx.uiWorkspace?.startSession?.()
    } catch {
      /* start is best-effort; the sidebar's New Session remains available */
    }
  }

  return (
    <>
      <div className="pocket-bar" role="navigation" aria-label="Session navigation">
        <button
          type="button"
          className="pocket-bar__btn"
          onClick={() => setSheetOpen(true)}
          aria-label={pending > 0 ? `Sessions, ${String(pending)} needing attention` : 'Sessions'}
        >
          <SessionsIcon />
          <span>Sessions</span>
          {pending > 0 ? <span className="pocket-badge">{pending > 9 ? '9+' : String(pending)}</span> : null}
        </button>
        <button type="button" className="pocket-bar__btn" onClick={startSession} aria-label="New session">
          <NewIcon />
          <span>New</span>
        </button>
        <button type="button" className="pocket-bar__btn" onClick={openDrawer} aria-label="More navigation and settings">
          <MoreIcon />
          <span>More</span>
        </button>
      </div>

      {sheetOpen
        ? createPortal(
            <div
              className="pocket-sheet-mask"
              onClick={(event) => {
                if (event.target === event.currentTarget) setSheetOpen(false)
              }}
            >
              <div className="pocket-sheet" role="dialog" aria-modal="true" aria-label="Sessions">
                <div className="pocket-sheet__head">
                  <div className="pocket-sheet__title">Sessions</div>
                  <button type="button" className="pocket-btn pocket-btn--primary" style={{ flex: '0 0 auto' }} onClick={startSession}>
                    New
                  </button>
                  <button type="button" className="pocket-icon-btn" aria-label="Close sessions" onClick={() => setSheetOpen(false)}>
                    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
                    </svg>
                  </button>
                </div>
                <div className="pocket-sheet__list">
                  {recent.length === 0 ? <div className="pocket-empty">No sessions yet. Start one with New.</div> : null}
                  {recent.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="pocket-row"
                      onClick={() => openSession(row.id)}
                      data-session-id={row.id}
                    >
                      <span className="pocket-row__title">{row.displayTitle ?? row.title ?? row.id}</span>
                      <span className="pocket-row__meta">
                        {row.running === true ? <span className="pocket-dot" aria-label="Running" /> : null}
                        <span>{row.blank === true ? 'New' : formatRelative(row.updatedAt)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {drawerOpen ? createPortal(<div className="pocket-backdrop" onClick={closeDrawer} aria-hidden="true" />, document.body) : null}
    </>
  )
}
