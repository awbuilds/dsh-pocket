# Implementation plan (as built)

> This is the approved plan, updated to record what shipped and what remains.
> The feature request was: control the running DeepSeek Harness Desktop app from
> a phone on the same LAN, "opencode-server style", without forking the app.

**Goal:** A pairing-authenticated gateway plugin + mobile web surface that lets a
phone on the same Wi-Fi drive the live Desktop sessions, using the real DSH web
client.

**Decisions:** PWA served by a DSH plugin · LAN only · running Desktop live
sessions · built-in gateway with QR + pairing code, signed device cookie, and
optional TLS.

**Runtime:** DSH `0.2.1-rc.5` (the version bundled in the Desktop app). The
global homebrew `dsh` is `0.2.0-rc.2`; scripts use
`npx @deepseek-ai/dsh@0.2.1-rc.5`.

---

## Phase 0 — Scaffold and install (done)

- [x] pnpm workspace, TypeScript, Vitest, esbuild build (`pnpm build`).
- [x] One package, one profile row: host `main` + browser `exports["./client"]`,
      `dsh.bundle.patch`, `dsh.client`.
- [x] `scripts/profile.mjs` — atomic bundle selection with backups; tested.
- [x] `scripts/install-desktop.mjs`, `scripts/uninstall-desktop.mjs`,
      `scripts/dev.mjs`.
- [x] Build assertions for the host exports and the client loader wrapper.

**Verification:** host bundle imports under Node; client bundle registers with
`window.__ModuleLoader__.load({ id: "@awbuilds/dsh-pocket" })` and returns `apply`/`inject`.

## Phase 1 — Gateway core (done)

- [x] `gateway-auth.ts`: six-digit single-use codes, TTL, per-IP + global
      lockout, HMAC device cookies, upstream cookie name, rate limiter.
- [x] `addresses.ts`: LAN IPv4 discovery, primary-route lookup, origins, loopback
      classification.
- [x] `secret.ts`: credentials record `dsh-pocket/gateway-session` with a
      mode-0600 file fallback; rotation.
- [x] `proxy.ts`: `http-proxy`, loopback Host rewrite, provenance stripping,
      hop-by-hop removal, 401 re-exchange, WS forwarding, 502 page.
- [x] `gateway.ts`: HTTP/HTTPS listener, port fallback, pairing page, cookie
      gating, PWA routes, `/pocket/*` 404, Origin checks, revocation, close.
- [x] `index.ts`: Cordis plugin, config schema, loopback `/pocket/info`,
      `/pocket/refresh`, `/pocket/revoke`, index transform, contained failures.
- [x] `pwa.ts` + icons: manifest, apple-touch icon, viewport/meta transform.

**Verification:** 40+ unit/integration tests; real 0.2.1-rc.5 host: pair,
proxied app 200, boot graph contains `@awbuilds/dsh-pocket`, plugin combo bundle 200,
WebSocket mux opens, revoke returns the device to `/pair`.

## Phase 2 — Desktop pairing UX (done)

- [x] `PairDialog`: QR (`qrcode-generator`), code, countdown, address picker,
      copy link, new code, revoke with confirmation, disabled/error states.
- [x] `SidebarAction`: `sidebar.footer.action` list entry, hidden on mobile.
- [x] Deep-link handler (`?session=` / `#session=`) reserved for notifications.
- [x] PWA manifest/icons served by the gateway; install meta injected into the
      upstream index.

**Verification:** real host desktop page shows **Link phone**, opens the dialog,
renders the QR and code, and refreshes/revokes; no console errors.

## Phase 3 — Mobile surface (done, device QA pending)

- [x] `mobile.ts`: media-query document marker, frame/sidebar tagging,
      visualViewport variables, focus scrolling, drawer marker.
- [x] `styles.ts`: rail removal (`0 1fr 0`), off-canvas sidebar, bottom bar,
      session sheet, modal, safe areas, `100dvh`, 16px inputs, coarse targets,
      reduced motion.
- [x] `MobileBar` in `shell.bottom`: Sessions sheet, New, More/drawer, pending
      badge, session selection via `ctx.uiWorkspace.openSession`, new session via
      `startSession`.
- [x] Desktop regression: bar absent, footer action present, frame unchanged.

**Verification:** real host at 390×844 in Chrome: bar renders, rail width 0px,
no horizontal overflow, sheet lists sessions, drawer slides to 321px with
backdrop, zero console errors. iOS Safari / Android Chrome checklist pending.

## Phase 4 — Hardening and docs (done except device QA)

- [x] Error surfaces in the dialog; 502 page; secret-free logs.
- [x] Port-conflict fallback and all-ports-busy containment.
- [x] Restart/expiry self-heal via the upstream token exchange.
- [x] 64 tests across auth, addresses, secrets, devices, PWA, profile edits, gateway
      request flow/listener lifecycle, host plugin, and client components.
- [x] Install, security, architecture, troubleshooting, mobile checklist docs.

## Remaining work

- [ ] Run [mobile-checklist.md](mobile-checklist.md) on an iPhone (Safari) and an
      Android phone (Chrome).
- [ ] Confirm the macOS firewall prompt and allow incoming connections.
- [ ] Optional Phase 5: ntfy/webhook notifications, mkcert guidance for TLS,
      service worker/offline shell, native shell wrapper.

## Review focus (still the riskiest areas)

1. **Mobile frame surgery** depends on `[data-sidebar-collapsed]`; a future DSH
   build that renames it leaves the rail. The Playwright/device check is the gate.
2. **Proxy fidelity** for long-lived WS/SSE through a corporate VPN or proxy.
3. **Upstream port/cookie rotation** — covered by the 401 self-heal, but a
   regression here silently shows the raw DSH 401 page.
4. **Port isolation** — a failed gateway must never affect the desktop app; the
   host plugin catches every start failure.
5. **Origin enforcement at the gateway** — the proxy strips Origin for the
   upstream fence, so the gateway itself must keep rejecting cross-site writes.

## Acceptance status

| Criterion | Status |
|---|---|
| Pair via QR, no manual URL | Passed (Chrome E2E + curl) |
| Unpaired `/api` 401 | Passed |
| Prompt/stream/approvals from phone | Not exercised (temp dev home has no model); transport verified |
| Mobile layout at 390×844 | Passed in Chrome; device QA pending |
| Restart without re-pairing | Design verified (cookie + token self-heal); restart E2E pending |
| Revoke invalidates devices | Passed |
| Desktop UI unchanged | Passed |
| Install/uninstall scripts | Dev profile install passed; Desktop install pending app quit |
