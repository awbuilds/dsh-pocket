# dsh-pocket

LAN mobile access for **DeepSeek Harness Desktop**. A pairing-authenticated
gateway sits in front of the running app's loopback web server, and a small
client plugin adds a phone navigation bar plus a "Link phone" dialog with a QR
code. The phone loads the real DSH web UI — chat, tools, approvals, questions —
over your local network.

- Gateway: `0.0.0.0:7317` (falls back to the next ports), loopback upstream.
- Pairing: six-digit code, QR, signed `HttpOnly` device cookie, 30-day lifetime.
- Mobile UI: bottom bar, session sheet, drawer sidebar, safe-area and keyboard fixes.
- No public exposure by default; optional TLS via `tlsCertFile` / `tlsKeyFile`.

## Install (Desktop)

```bash
pnpm install
pnpm build
# Quit DeepSeek Harness completely, then:
node scripts/install-desktop.mjs
# Reopen DeepSeek Harness. Click the phone icon at the bottom of the sidebar.
```

The script installs this package into `~/.dsh/profiles/desktop` using the
matching DSH CLI and enables its bundle. See [docs/install.md](../../docs/install.md).

## Develop

```bash
pnpm test
pnpm typecheck
node scripts/dev.mjs   # a separate pocket-dev profile, not the Desktop profile
```

## Security model

The phone reaches only the gateway. The gateway requires a device cookie issued
after a short-lived pairing code, checks Origins on writes and WebSocket
upgrades, and proxies with a loopback Host so the upstream trust fence is
satisfied. Plain HTTP is the v1 transport for a trusted home network; configure
TLS before using it on a network you do not control. See
[docs/security.md](../../docs/security.md).

## Uninstall

```bash
node scripts/uninstall-desktop.mjs
```
