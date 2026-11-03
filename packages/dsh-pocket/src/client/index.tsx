/**
 * Browser plugin entry.
 *
 * It installs the mobile stylesheet and document state, contributes the bottom
 * navigation bar and the sidebar's "Link phone" action, and honours a session
 * deep link (used by the optional notification channel). All registrations are
 * effect-scoped, so unloading the plugin removes every trace.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { installMobile } from './mobile.ts'
import { MobileBar } from './MobileBar.tsx'
import { SidebarAction } from './SidebarAction.tsx'
import { styles } from './styles.ts'

/** Stable Cordis plugin name for the browser half. */
export const name = 'dsh-pocket-client'

/** Client services the plugin's UI reaches for. */
export const inject = ['slots', 'sessions', 'uiWorkspace', 'layout']

function installStyle(): HTMLStyleElement {
  for (const existing of document.querySelectorAll('style[data-plugin-css="dsh-pocket"]')) existing.remove()
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-pocket'
  style.textContent = styles
  document.head.append(style)
  return style
}

function openSessionDeepLink(ctx: Context): void {
  let session: string | null = null
  try {
    session = new URLSearchParams(location.search).get('session')
    if (session === null && location.hash.length > 1) {
      session = new URLSearchParams(location.hash.slice(1)).get('session')
    }
  } catch {
    return
  }
  if (session === null || session === '') return
  let attempts = 0
  const open = (): void => {
    attempts += 1
    try {
      ctx.uiWorkspace.openSession(session as never)
    } catch {
      if (attempts < 4) window.setTimeout(open, 600)
    }
  }
  window.setTimeout(open, 800)
}

/**
 * Mount the mobile surface.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const style = installStyle()
  const disposeMobile = installMobile()
  ctx.effect(() => () => {
    style.remove()
    disposeMobile()
  })

  const bar = (props: any): React.JSX.Element => <MobileBar {...props} ctx={ctx} />
  const action = (props: any): React.JSX.Element => <SidebarAction {...props} ctx={ctx} />

  ctx.slots.inject('shell.bottom', () => ctx.slots.register({ name: 'shell.bottom' }, bar))
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({ name: 'sidebar.footer.action', id: 'pocket', order: 100 }, action),
  )

  openSessionDeepLink(ctx)
}
