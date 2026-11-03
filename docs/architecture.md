# Architecture

## Components

| Piece | File | Responsibility |
|---|---|---|
| Cordis host plugin | `src/host/index.ts` | Config schema, gateway lifecycle, loopback `/pocket/*` routes, index transform |
| Gateway | `src/host/gateway.ts` | Listener, port fallback, TLS, routing, pairing page, device cookies, PWA assets |
| Auth primitives | `src/host/gateway-auth.ts` | Pairing codes, rate limits, HMAC cookies, upstream cookie name |
| Proxy | `src/host/proxy.ts` | `http-proxy` wiring, header rewrite, 401 self-heal, WS forwarding |
| Secret store | `src/host/secret.ts` | Credentials record or `0600` file |
| LAN discovery | `src/host/addresses.ts` | IPv4 enumeration, primary-route lookup, origins |
| PWA | `src/host/pwa.ts` | Manifest, icons, viewport/install meta transform |
| Browser plugin | `src/client/index.tsx` | Style injection, mobile document state, slot registrations, deep link |
| Mobile bar | `src/client/MobileBar.tsx` | `shell.bottom` occupant: Sessions, New, More, session sheet, drawer |
| Pairing dialog | `src/client/PairDialog.tsx`, `qr.tsx` | QR, code, address picker, refresh, revoke |
| Sidebar action | `src/client/SidebarAction.tsx` | `sidebar.footer.action` entry |
| Mobile CSS/state | `src/client/styles.ts`, `mobile.ts` | Drawer, safe areas, keyboard, frame tagging |

The package is one profile **bundle** (`cordis.patch.yml` inserts one row named
`pocket`) and one **client plugin** (`dsh.client`). The same row supplies both:
the host entry is `main`, the browser entry is `exports["./client"]`.

## Why a gateway instead of rebinding DSH

`dsh-host-webserver` accepts only a concrete local IP and deliberately rejects
wildcards; the Desktop host also passes `--host 127.0.0.1 --port 0` and mints a
per-process launch token. Rebinding it would mean changing the app's launch
arguments, exposing the loopback port directly, and losing a stable address.

The gateway instead:

- owns a stable, configurable port (7317, with fallbacks);
- adds a device credential that survives desktop restarts and the upstream's
  changing random port;
- can serve TLS without touching the app's listener;
- keeps the upstream's token exchange and cookie flow intact.

## Pairing transaction

```
Desktop dialog                Gateway                         DSH loopback server
     │ GET /pocket/info (loopback, DSH cookie)
     │──────────────────────────────────────────────────────────────▶
     │ { origins, pairing:{code,expiresAt} }
     │◀──────────────────────────────────────────────────────────────
     │ QR = origin/pair#code
     ▼
Phone GET /pair ──────────────▶ page
Phone POST /pair {code} ──────▶ verify + Set-Cookie: dsh-pocket-session
Phone GET / ──────────────────▶ no upstream cookie
                              │ 303 /?token=<process token>
Phone GET /?token=... ────────▶ proxy ─────────────────────────────▶ GET / with token
                              │◀─────────────────────────────────── 303 ./ + Set-Cookie dsh-auth-*
Phone GET / (both cookies) ───▶ proxy ─────────────────────────────▶ 200 index
Phone /api + /api/remote.mux ─▶ proxy ─────────────────────────────▶ RPC / WS mux
```

When the upstream returns 401 for a document navigation, the proxy repeats the
token exchange once. This covers a new random upstream port, a restarted
desktop host, and an expired DSH cookie. A request that already carries a token
is passed through, which prevents a redirect loop.

## Reconnects

The phone may hold only the gateway cookie when a page is reopened. The gateway
mints a fresh DSH launch token for each upstream login exchange (a consumed
token caused a redirect loop), and the proxy rewrites DSH's `SameSite=Strict`
auth cookie to `Lax` so a home-screen PWA launch can send it on the top-level
navigation. Last-seen touches never rename an existing device.

## Mobile layout

The DSH frame has no mobile breakpoint. The client plugin marks the document
(`data-pocket-mobile`) and tags the frame and its first column with stable
`data-pocket-*` attributes, then:

- collapses the frame's grid tracks to `0 1fr 0` so the 56px rail disappears;
- makes the sidebar column a fixed off-canvas drawer (`min(86vw, 320px)`);
- adds a `shell.bottom` bar that replaces the rail's navigation role;
- applies safe-area insets, `100dvh`, 16px inputs (iOS zoom), coarse-pointer
  target sizes, and keyboard/focus scrolling.

The bar's Sessions sheet uses the framework's `useSessions` standard hook and
`ctx.uiWorkspace.openSession`; New uses `ctx.uiWorkspace.startSession`; More
opens the real sidebar as the drawer. The desktop UI is untouched because every
rule is scoped under the mobile attribute.

## Data flow for approvals/questions

The phone loads the real DSH client; approvals and user questions arrive through
the existing forwarded-event streams and are answered through the existing
Remote methods. No new approval bridge exists, so the Mac and the phone share
one host decision and whichever client answers first settles it. The gateway
only carries the transport.

## Version coupling

The bundle targets DSH **0.2.1-rc.5**. It relies on:

- `shell.bottom` and `sidebar.footer.action` slots (0.2.1);
- `ctx.layout`, `ctx.sessions`, `ctx.uiWorkspace`, `ctx.slots`;
- `ctx.webServer.register/getOrigin/tapIndex`;
- `ctx.connection.authenticatedUrl/requestRejection`;
- the `/api` trust fence's loopback Host rule.

An incompatible runtime fails the bundle peer check, and the plugin's own
gateway start failure is contained and surfaced in the dialog.
