# DSH Pocket

Control the **running DeepSeek Harness Desktop app** from your phone on the same
network. A small, additive plugin starts a pairing-authenticated gateway in front
of the app's loopback web server; the phone loads the real DSH web UI, with a
mobile navigation bar, a session sheet, and the desktop sidebar as a drawer.

![Mobile drawer](docs/assets/mobile-drawer.png)

## What it gives you

- **QR pairing** from the desktop sidebar: scan once, stay paired for 30 days.
- **The real app**, not a reimplementation: chat, streaming tool calls,
  approvals, questions, files, and sessions all behave as on the Mac.
- **A phone layout**: the 56px rail is replaced by a bottom bar, sessions open
  in a sheet, the full sidebar slides in from the left, and the composer respects
  safe areas and the on-screen keyboard.
- **A stable LAN endpoint**: the gateway listens on `0.0.0.0:7317` (with
  fallbacks) and proxies to the app's random loopback port, so the phone's URL
  survives desktop restarts.
- **Contained failure**: a busy port, missing TLS file, or unreachable upstream
  never stops the desktop app; the pairing dialog reports the problem.
- **Revocation**: one button invalidates every paired device immediately.

## Quick start

```bash
git clone https://github.com/awbuilds/dsh-pocket.git
cd dsh-pocket
pnpm install
pnpm build
pnpm test

# Quit DeepSeek Harness completely, then:
node scripts/install-desktop.mjs
```

Reopen the app, click **Link phone** at the bottom of the sidebar, and scan the
QR code.

Full instructions: [docs/install.md](docs/install.md).
Security model: [docs/security.md](docs/security.md).
Architecture: [docs/architecture.md](docs/architecture.md).
Troubleshooting: [docs/troubleshooting.md](docs/troubleshooting.md).

## How it works

```
phone ──▶ gateway 0.0.0.0:7317 ──▶ DSH loopback server 127.0.0.1:<random>
          pairing cookie,            launch-token exchange,
          Origin checks,             signed browser cookie,
          TLS optional               /api RPC + remote.mux WS
```

The gateway keeps the DSH listener on loopback. It rewrites the proxied Host to
the loopback authority and strips browser provenance headers so the upstream
trust fence accepts the request, while the gateway's own signed cookie is the
LAN-facing credential. A document navigation without the upstream cookie is
bounced through the process launch token once; the same path heals an expired
upstream session.

The bundle is one profile row (`pocket`, package `dsh-pocket`) that supplies both
halves: the host entry starts the gateway and the browser entry adds the mobile
surface through the app's own slot system (`shell.bottom`,
`sidebar.footer.action`).

Over plain HTTP, iOS *Add to Home Screen* works while Chrome's install prompt needs TLS. Set `tlsCertFile` / `tlsKeyFile` for an HTTPS gateway.

## Compatibility

Built against DSH **0.2.1-rc.5** (the runtime bundled in the Desktop app). The
bundle declares that peer; a runtime upgrade needs a rebuild against the new
version. See [docs/install.md](docs/install.md#update-after-a-dsh-upgrade).

## Status

- Automated: 52 unit/integration/component tests, typecheck, host + client builds.
- Verified against a real 0.2.1-rc.5 host: pairing, proxying, boot graph, plugin
  bundle, WebSocket mux, mobile bar, session sheet, drawer, desktop dialog, and
  revocation.
- Pending: the real-device checklist in
  [docs/mobile-checklist.md](docs/mobile-checklist.md) on iOS Safari and Android
  Chrome (keyboard behavior, safe areas, background reconnect).

## License

MIT. See [LICENSE](LICENSE).
