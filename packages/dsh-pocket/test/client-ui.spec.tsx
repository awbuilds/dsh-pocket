// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MobileBar } from '../src/client/MobileBar.tsx'
import { PairDialog } from '../src/client/PairDialog.tsx'
import { setDrawerOpen, installMobile } from '../src/client/mobile.ts'
import type { PocketInfo } from '../src/shared/types.ts'

function mockMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  mockMatchMedia(true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-pocket-mobile')
  document.documentElement.removeAttribute('data-pocket-drawer')
  document.body.innerHTML = ''
})

describe('MobileBar', () => {
  function renderBar(overrides: Record<string, unknown> = {}) {
    const list = {
      ids: ['s1', 's2'],
      byId: {
        s1: { id: 's1', displayTitle: 'Alpha', updatedAt: Date.now(), running: true },
        s2: { id: 's2', displayTitle: 'Beta', updatedAt: Date.now() - 60_000, running: false },
      },
      phase: 'ready',
    }
    const statuses = new Map([['s1', { pendingInteraction: { key: 'a', kind: 'approval', sessionId: 's1' } }]])
    const ctx = {
      uiWorkspace: { openSession: vi.fn(), startSession: vi.fn() },
      layout: { toggleSidebar: vi.fn() },
    }
    const useSessions = (selector: (state: unknown) => unknown) => selector(list)
    const useSessionStatus = (selector: (state: unknown) => unknown) => selector(statuses)
    render(
      <MobileBar
        ctx={ctx}
        useSessions={useSessions as never}
        useSessionStatus={useSessionStatus as never}
        {...overrides}
      />,
    )
    return { ctx }
  }

  it('renders the three navigation buttons and a pending badge', () => {
    renderBar()
    expect(screen.getByRole('navigation', { name: 'Session navigation' })).toBeTruthy()
    expect(screen.getByText('Sessions')).toBeTruthy()
    expect(screen.getByText('New')).toBeTruthy()
    expect(screen.getByText('More')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('opens the session sheet, lists sessions, and opens the chosen one', () => {
    const { ctx } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /Sessions/ }))
    expect(screen.getByRole('dialog', { name: 'Sessions' })).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    fireEvent.click(screen.getByText('Alpha'))
    expect(ctx.uiWorkspace.openSession).toHaveBeenCalledWith('s1')
    expect(screen.queryByRole('dialog', { name: 'Sessions' })).toBeNull()
  })

  it('starts a new session from the bar', () => {
    const { ctx } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    expect(ctx.uiWorkspace.startSession).toHaveBeenCalledTimes(1)
  })

  it('opens the sidebar drawer and closes it from the backdrop', () => {
    const { ctx } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'More navigation and settings' }))
    expect(ctx.layout.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(document.documentElement.getAttribute('data-pocket-drawer')).toBe('open')
    fireEvent.click(screen.getByRole('navigation', { name: 'Session navigation' }))
    // The backdrop is portalled beside the bar; find it by class.
    const backdrop = document.querySelector('.pocket-backdrop')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect(ctx.layout.toggleSidebar).toHaveBeenCalledTimes(2)
    expect(document.documentElement.hasAttribute('data-pocket-drawer')).toBe(false)
  })
})

const INFO: PocketInfo = {
  status: 'running',
  protocol: 'http:',
  port: 7317,
  addresses: ['192.168.1.40'],
  origins: ['http://192.168.1.40:7317', 'http://127.0.0.1:7317'],
  pairing: { code: '123456', expiresAt: Date.now() + 300_000, ttlSeconds: 300 },
  upstreamOrigin: 'http://127.0.0.1:50000',
  tls: false,
  version: 'test',
  devices: [
    {
      id: 'sid-moto',
      label: 'moto g40 fusion · Chrome',
      address: '192.168.1.50',
      createdAt: Date.now() - 60_000,
      lastSeenAt: Date.now() - 5_000,
    },
  ],
}

function stubFetch(info: PocketInfo = INFO): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith('/pocket/revoke')) {
      return new Response(JSON.stringify({ revokedAt: Date.now() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (path.endsWith('/pocket/devices/revoke')) {
      return new Response(JSON.stringify({ removed: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(info), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock as unknown as ReturnType<typeof vi.fn>
}

describe('PairDialog', () => {
  it('shows the pairing code, QR, and reachable origin', async () => {
    stubFetch()
    render(<PairDialog onClose={() => {}} />)
    expect(await screen.findByText('123456')).toBeTruthy()
    expect(screen.getByLabelText(/Pairing QR code/)).toBeTruthy()
    expect(screen.getByText('http://192.168.1.40:7317/pair#123456')).toBeTruthy()
  })

  it('rotates the code and confirms before revoking', async () => {
    const fetchMock = stubFetch()
    render(<PairDialog onClose={() => {}} />)
    await screen.findByText('123456')

    fireEvent.click(screen.getByRole('button', { name: 'New code' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/pocket/refresh'))).toBe(true)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Revoke devices' }))
    expect(screen.getByText(/Revoke every paired device/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/pocket/revoke'))).toBe(true)
    })
  })

  it('lists the paired device and removes it', async () => {
    const fetchMock = stubFetch()
    render(<PairDialog onClose={() => {}} />)
    expect(await screen.findByText('moto g40 fusion · Chrome')).toBeTruthy()
    expect(screen.getByText(/192\.168\.1\.50/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove moto g40 fusion · Chrome' }))
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input).endsWith('/pocket/devices/revoke') && String(init?.body).includes('sid-moto'),
        ),
      ).toBe(true)
    })
  })

  it('explains a disabled gateway', async () => {
    stubFetch({ ...INFO, status: 'disabled', port: 0, origins: [], addresses: [], error: 'Remote access is disabled.' })
    render(<PairDialog onClose={() => {}} />)
    expect(await screen.findByText(/Remote access is disabled/)).toBeTruthy()
  })

  it('closes on Escape', async () => {
    stubFetch()
    const onClose = vi.fn()
    render(<PairDialog onClose={onClose} />)
    await screen.findByText('123456')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('installMobile', () => {
  it('marks the document and the frame, exposes the drawer, and cleans up', () => {
    document.body.innerHTML =
      '<div data-sidebar-collapsed><div id="sidebar"></div><div id="center"></div></div>'
    const dispose = installMobile()
    const frame = document.querySelector('[data-sidebar-collapsed]') as HTMLElement
    expect(document.documentElement.hasAttribute('data-pocket-mobile')).toBe(true)
    expect(frame.hasAttribute('data-pocket-frame')).toBe(true)
    expect(frame.firstElementChild?.hasAttribute('data-pocket-sidebar')).toBe(true)

    setDrawerOpen(true)
    expect(document.documentElement.getAttribute('data-pocket-drawer')).toBe('open')
    setDrawerOpen(false)
    expect(document.documentElement.hasAttribute('data-pocket-drawer')).toBe(false)

    dispose()
    expect(document.documentElement.hasAttribute('data-pocket-mobile')).toBe(false)
    expect(frame.hasAttribute('data-pocket-frame')).toBe(false)
  })
})
