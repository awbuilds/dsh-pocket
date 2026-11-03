/**
 * Mobile detection and frame tagging.
 *
 * The DSH layout has no mobile mode, so this module marks the document and the
 * frame's own DOM nodes with stable data attributes. CSS can then turn the left
 * column into a drawer without depending on the app's hashed CSS-module class
 * names, which are private to each build.
 */
import { useEffect, useState } from 'react'

/** Width at which the desktop frame becomes cramped on a phone-class viewport. */
export const MOBILE_QUERY = '(max-width: 900px)'

const MOBILE_ATTRIBUTE = 'data-pocket-mobile'
const FRAME_ATTRIBUTE = 'data-pocket-frame'
const SIDEBAR_ATTRIBUTE = 'data-pocket-sidebar'
const MAIN_ATTRIBUTE = 'data-pocket-main'
const RIGHT_ATTRIBUTE = 'data-pocket-right'

function mediaQuery(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  return window.matchMedia(MOBILE_QUERY)
}

/** React hook over the mobile media query. */
export function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => mediaQuery()?.matches ?? false)
  useEffect(() => {
    const query = mediaQuery()
    if (query === undefined) return
    const onChange = (): void => setMobile(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return mobile
}

function tagColumns(frame: HTMLElement): void {
  const [sidebar, main, right] = frame.children
  if (sidebar instanceof HTMLElement) sidebar.setAttribute(SIDEBAR_ATTRIBUTE, '')
  // The drawer becomes position: fixed, which takes it out of the frame's grid
  // flow. Without explicit places the remaining columns auto-place one track to
  // the left, collapsing the chat into the zero-width rail.
  if (main instanceof HTMLElement) main.setAttribute(MAIN_ATTRIBUTE, '')
  if (right instanceof HTMLElement) right.setAttribute(RIGHT_ATTRIBUTE, '')
}

function tagFrame(): void {
  const existing = document.querySelector<HTMLElement>(`[${FRAME_ATTRIBUTE}]`)
  if (existing !== null) {
    tagColumns(existing)
    return
  }
  // The frame is the grid that carries the sidebar-collapsed state. It exists
  // once ui-layout has mounted; the observer below retries until then.
  const frame = document.querySelector<HTMLElement>('[data-sidebar-collapsed]')
  if (frame === null) return
  frame.setAttribute(FRAME_ATTRIBUTE, '')
  tagColumns(frame)
}

function setMobileAttribute(mobile: boolean): void {
  const root = document.documentElement
  if (mobile) {
    root.setAttribute(MOBILE_ATTRIBUTE, '')
    tagFrame()
  } else {
    root.removeAttribute(MOBILE_ATTRIBUTE)
    root.removeAttribute('data-pocket-drawer')
  }
}

/**
 * Install the document-level mobile state: the media-query marker, frame
 * tagging, safe-area/keyboard variables, and focus scrolling for the composer.
 * @returns cleanup for the plugin's effect lifetime.
 */
export function installMobile(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  const query = mediaQuery()
  const apply = (): void => setMobileAttribute(query?.matches ?? false)
  apply()

  const observer = new MutationObserver(() => {
    if (query?.matches === true) tagFrame()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  const onQueryChange = (): void => apply()
  query?.addEventListener('change', onQueryChange)

  const onViewport = (): void => {
    const viewport = window.visualViewport
    if (viewport == null) return
    const keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    document.documentElement.style.setProperty('--pocket-kb', `${String(Math.round(keyboard))}px`)
    document.documentElement.style.setProperty('--pocket-vh', `${String(Math.round(viewport.height))}px`)
  }
  window.visualViewport?.addEventListener('resize', onViewport)
  window.visualViewport?.addEventListener('scroll', onViewport)
  window.addEventListener('resize', onViewport)
  onViewport()

  const onFocus = (event: FocusEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT') return
    if (target.closest('[data-pocket-mobile] [data-pocket-frame]') === null) return
    window.setTimeout(() => {
      try {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } catch {
        target.scrollIntoView()
      }
    }, 120)
  }
  document.addEventListener('focusin', onFocus, true)

  return () => {
    observer.disconnect()
    query?.removeEventListener('change', onQueryChange)
    window.visualViewport?.removeEventListener('resize', onViewport)
    window.visualViewport?.removeEventListener('scroll', onViewport)
    window.removeEventListener('resize', onViewport)
    document.removeEventListener('focusin', onFocus, true)
    document.documentElement.removeAttribute(MOBILE_ATTRIBUTE)
    document.documentElement.removeAttribute('data-pocket-drawer')
    document.documentElement.style.removeProperty('--pocket-kb')
    document.documentElement.style.removeProperty('--pocket-vh')
    document
      .querySelectorAll(`[${FRAME_ATTRIBUTE}], [${SIDEBAR_ATTRIBUTE}], [${MAIN_ATTRIBUTE}], [${RIGHT_ATTRIBUTE}]`)
      .forEach((node) => {
        node.removeAttribute(FRAME_ATTRIBUTE)
        node.removeAttribute(SIDEBAR_ATTRIBUTE)
        node.removeAttribute(MAIN_ATTRIBUTE)
        node.removeAttribute(RIGHT_ATTRIBUTE)
      })
  }
}

/** Open or close the drawer marker used by the stylesheet. */
export function setDrawerOpen(open: boolean): void {
  if (typeof document === 'undefined') return
  if (open) document.documentElement.setAttribute('data-pocket-drawer', 'open')
  else document.documentElement.removeAttribute('data-pocket-drawer')
}
