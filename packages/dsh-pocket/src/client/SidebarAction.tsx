/**
 * Sidebar footer entry that opens the pairing dialog. Hidden on a phone: that
 * surface is the device being paired, not the one handing out codes.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMobile } from './mobile.ts'
import { PairDialog } from './PairDialog.tsx'

/** Sidebar list-slot owner share, as supplied by ui-sidebar. */
export interface SidebarActionProps {
  wide?: boolean
  ctx?: unknown
}

function PhoneIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <rect x="5.4" y="2.4" width="9.2" height="15.2" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.6 15h2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M2.2 8.2a4.6 4.6 0 0 1 0 3.6M3.9 9.1a2.4 2.4 0 0 1 0 1.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** One footer action; opens the portal-hosted dialog. */
export function SidebarAction({ wide = false }: SidebarActionProps): React.JSX.Element | null {
  const mobile = useMobile()
  const [open, setOpen] = useState(false)
  if (mobile) return null
  return (
    <>
      <button
        type="button"
        className="pocket-footer-action"
        title="Link phone"
        aria-label="Link phone"
        onClick={() => setOpen(true)}
      >
        <PhoneIcon />
        {wide ? <span>Link phone</span> : null}
      </button>
      {open ? createPortal(<PairDialog onClose={() => setOpen(false)} />, document.body) : null}
    </>
  )
}
