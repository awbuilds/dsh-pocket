# Troubleshooting

## The dialog says "Remote access is disabled"

The `pocket` row has `enabled: false` in the profile patch. Set it to `true`,
then restart DeepSeek Harness. The row is inserted by the bundle patch; override
it in your profile's `cordis.patch.yml`:

```yaml
- id: pocket
  config:
    enabled: true
```

## The dialog says the gateway could not start

The most common causes:

- **Port range occupied.** The gateway tries `7317` through `7326`. Close the
  conflicting process or change `port` / `portAttempts` in the patch.
- **TLS material unreadable.** Paths resolve against the app's working
  directory; use absolute paths. Supplying only one of `tlsCertFile` /
  `tlsKeyFile` is an error.
- **Secret file.** If `$DSH_HOME/pocket/gateway-session` is unreadable, delete
  the `pocket` folder and restart; a new secret is created.

The desktop app keeps working in every one of these cases.

## The phone cannot reach the page

- Confirm both devices are on the same network, not a guest SSID with client
  isolation.
- The dialog lists every LAN address; try each one (VPN/Tailscale addresses may
  sort after Wi-Fi).
- Allow incoming connections for DeepSeek Harness in **System Settings →
  Network → Firewall**.
- If the Mac's IP changed, reopen the dialog and scan the new QR. The old
  bookmark will not resolve.
- `http://127.0.0.1:7317` works only on the Mac itself.

## The QR scans but the code is rejected

Codes rotate every five minutes and are single-use. Open **Link phone** again to
get a fresh code. Repeated failures lock the phone address for 15 minutes by
default; wait, or restart the gateway (restart DSH) to clear the in-memory
limiter.

## The phone shows the app but the Mac's session list is empty

The phone is talking to the same host, so the list should match. If it does not,
the page is probably cached from an older origin/port. Close the tab and scan a
fresh QR; the gateway's upstream cookie self-heals on the next navigation.

## "dsh web authentication required" on the phone

The gateway's upstream exchange is retried once on a document navigation. If you
see the raw 401, reload the page. If it persists, the desktop's connection
service may not be ready; restart DSH and reopen the dialog.

## WebSocket updates stop after backgrounding

The DSH client reconnects on a foreground/online transition. If it does not,
pull-to-refresh the page. The gateway proxies `/api/remote.mux`; a corporate
proxy or VPN that strips WebSocket upgrades will break live updates while
unary calls still work.

## The mobile layout is wrong

The frame tagging depends on the layout's `data-sidebar-collapsed` marker. If a
future DSH build renames it, the bottom bar still works but the rail may remain.
Update the selector in `src/client/mobile.ts` (`tagFrame`) and rebuild. The CSS
fallback (`data-pocket-sidebar`) is tagged by the same function.

## The desktop window changed

Every mobile rule is scoped to `html[data-pocket-mobile]`, which is applied only
below 900px. If the Desktop window is narrower than that, the phone layout
appears by design. Widen the window to restore it.

## `dsh plugin --profile desktop` says the profile is managed exclusively

This is expected: DSH 0.2.1 reserves the Desktop profile for the Electron app.
Do not use the CLI for it. Install from **Plugins** in the left sidebar in the running app
(local path, release tarball, or npm package name). If the Plugins page rejects a
local path, quit the app and run `node scripts/install-desktop.mjs --manual`.

## The app's Plugins page rejects the local package

Use the generated tarball instead: run `cd packages/dsh-pocket && npm pack` and
select `awbuilds-dsh-pocket-0.0.2.tgz` in the Plugins page. Keep the tarball where
it is; the profile references that path. The npm package is an alternative once
published.

## Version mismatch after a DSH update

The bundle peer-pins `0.2.1-rc.5`. Rebuild and reinstall against the new
runtime, or grant a version exemption only after checking the slot/service APIs.
