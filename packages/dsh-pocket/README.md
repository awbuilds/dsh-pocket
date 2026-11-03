# DSH Pocket

npm package: [`@awbuilds/dsh-pocket`](https://www.npmjs.com/package/@awbuilds/dsh-pocket)

LAN mobile access for **DeepSeek Harness Desktop**. A pairing-authenticated
gateway sits in front of the running app's loopback web server, and a small
client plugin adds a phone navigation bar plus a "Link phone" dialog with a QR
code. The phone loads the real DSH web UI — chat, tools, approvals, questions —
over your local network.

- Gateway: `0.0.0.0:7317` (falls back to the next ports), loopback upstream.
- Pairing: six-digit code, QR, signed `HttpOnly` device cookie, 30-day lifetime.
- Connected devices: a persistent per-device allowlist shown in the Link phone
  dialog, with last-seen time and one-tap removal.
- Mobile UI: bottom bar, session sheet, drawer sidebar, safe-area and keyboard fixes.
- No public exposure by default; optional TLS via `tlsCertFile` / `tlsKeyFile`.

## Release notes

### 0.0.4

- Fixed the phone view rendering blank after pairing: the drawer no longer
  pulls the main chat column out of the app's grid. Session history, the
  composer, the session sheet, and the drawer all render correctly, and the
  desktop layout is unchanged.

### 0.0.3

- Paired-device list with per-device removal, and reconnect fixes for
  Android/Chrome after a host restart.

## Install (Desktop)

The Desktop profile is managed by the app; DSH 0.2.1's CLI rejects
`dsh plugin --profile desktop`. Install from inside the running app:

1. Open **Plugins** in the left sidebar and click **Add plugin**.
2. Keep **Registry** on **Official npm registry** and enter
   `@awbuilds/dsh-pocket@0.0.4`.
   Alternatively, install the release tarball (`awbuilds-dsh-pocket-0.0.4.tgz`)
   or the local package directory.
3. Enable the **`@awbuilds/dsh-pocket`** bundle.
4. If **Link phone** does not appear, restart DeepSeek Harness once.

For a manifest-level fallback, quit the app and run
`node scripts/install-desktop.mjs --manual` from a source checkout. See
[docs/install.md](../../docs/install.md).

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
