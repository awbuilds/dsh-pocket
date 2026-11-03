# Install

The plugin runs inside **DeepSeek Harness Desktop** and is selected through a
profile bundle. It is additive: it starts its own LAN listener and does not
reconfigure or replace the app's loopback web server.

## Prerequisites

- macOS with DeepSeek Harness Desktop 0.2.1-rc.5 (the bundle pins this runtime).
- Node.js 22 or newer and pnpm 9+ for building.
- The phone and the Mac on the same Wi-Fi/LAN, without guest-network client
  isolation.
- Permission to allow incoming connections for the app in the macOS firewall.

## Build

```bash
git clone https://github.com/awbuilds/dsh-pocket.git
cd dsh-pocket
pnpm install
pnpm build
pnpm test
```

`pnpm build` writes `packages/dsh-pocket/lib/index.js` and `lib/client.js`. The
install script refuses to run without both.

## Install into the Desktop profile

1. **Quit DeepSeek Harness completely** — menu bar → Quit, not just closing the
   window. The script refuses while the app is running because the profile's
   package manager is locked by the app.
2. Run:

   ```bash
   node scripts/install-desktop.mjs
   ```

   The script installs the package as a local `link:` dependency, so keep this repository in place while the Desktop profile uses it. For a self-contained copy, run `pnpm --filter dsh-pocket pack` and install the resulting tarball through **Settings → Plugins**, then rerun with `--skip-install`.

   The script installs the package with the matching CLI
   (`npx @deepseek-ai/dsh@0.2.1-rc.5`) and appends `dsh-pocket` to the
   profile's ordered bundle list, leaving a timestamped backup of the profile
   `package.json`.

   If the package install fails, install the local package from
   **Settings → Plugins** in the app, then run
   `node scripts/install-desktop.mjs --skip-install` to select the bundle.

3. Reopen DeepSeek Harness.
4. At the bottom of the left sidebar, click **Link phone**. A dialog shows a QR
   code, a six-digit code, and the reachable LAN addresses.
5. Scan the QR with the phone's camera. The pairing page fills in the code and
   opens the app. If the scan did not carry the code, enter the six digits.
6. The first launch may prompt for the macOS firewall; allow it.

Over plain HTTP, iOS **Add to Home Screen** still works; Chrome's install prompt and service workers require TLS. Configure `tlsCertFile`/`tlsKeyFile` for full PWA installability.

The gateway binds all interfaces by default. To restrict it to one Wi-Fi address, set `bindHost: 192.168.x.y` in the `pocket` row; the dialog then advertises only that address.

The phone stays paired for 30 days. **Revoke devices** in the dialog invalidates
every phone immediately. Restarting the Mac/DSH does not require re-pairing.

## Update after a DSH upgrade

The bundle pins DSH `0.2.1-rc.5`. If the app updates, update
`packages/dsh-pocket/package.json`'s `@deepseek-ai/dsh` peer (and the matching
`@deepseek-ai/dsh-*` dev dependencies), rebuild, then reinstall:

```bash
pnpm install
pnpm build
node scripts/uninstall-desktop.mjs
node scripts/install-desktop.mjs
```

The plugin manager may offer a version exemption instead of a reinstall; only
accept it after checking that the slot and service APIs used by this bundle are
unchanged.

## Uninstall

Quit the app, then:

```bash
node scripts/uninstall-desktop.mjs
```

This deselects the bundle first (so the next launch never references a removed
package), then removes the package. The gateway secret at
`$DSH_HOME/pocket/gateway-session` is kept; delete the folder for a fresh
gateway identity.

## Verify

- The app starts normally and the **Link phone** action is visible.
- `http://<lan-ip>:7317/pair` loads on the phone.
- The paired phone shows the bottom bar (Sessions / New / More).
- The Desktop window is visually unchanged.

## Dev profile (optional)

The Desktop profile cannot be booted from a terminal. Use a disposable Web
profile instead:

```bash
node scripts/dev.mjs
```

It creates `~/.dsh-pocket-dev/profiles/pocket-dev`, installs the plugin, and
boots a host there. That home has no model credentials, so the UI, pairing, and
mobile surface work but chat requires a signed-in account. For a real-data
throwaway host, set `DSH_HOME` and quit the Desktop app first.
