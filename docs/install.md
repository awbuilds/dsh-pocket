# Install

The plugin runs inside **DeepSeek Harness Desktop** and is selected through a
profile bundle. It is additive: it starts its own LAN listener and does not
reconfigure or replace the app's loopback web server.

## Prerequisites

- macOS with DeepSeek Harness Desktop 0.2.1-rc.5 (the bundle pins this runtime).
- Node.js 22 or newer and pnpm 9+ only if you build from source.
- The phone and the Mac on the same Wi-Fi/LAN, without guest-network client
  isolation.
- Permission to allow incoming connections for the app in the macOS firewall.

## Install from inside the app

The **Desktop profile is managed exclusively by the app**. DSH 0.2.1's CLI
rejects `dsh plugin --profile desktop` from a terminal, whether or not the app
is running. Use the app's own installer:

1. Open **Plugins** in the left sidebar in DeepSeek Harness and click **Add
   plugin**.
2. Provide one of:
   - the npm package `@awbuilds/dsh-pocket@0.0.4`, with **Registry** set to
     **Official npm registry**
   - the release tarball: `awbuilds-dsh-pocket-0.0.4.tgz`
   - the local package directory:
     `~/RealWorldProjects/deepseek_mobile/packages/dsh-pocket`
   - the GitHub repository: `https://github.com/awbuilds/dsh-pocket`
3. Enable the **`@awbuilds/dsh-pocket`** bundle.
4. If **Link phone** does not appear at the bottom of the sidebar, restart
   DeepSeek Harness once.

The app's installer runs the profile's package manager and records the bundle in
`~/.dsh/profiles/desktop/package.json`. Keeping the local package or tarball at
the path you install from matters: the profile references it.

### If the Plugins page does not accept a local path

Quit DeepSeek Harness completely (menu bar → Quit), then run:

```bash
cd ~/RealWorldProjects/deepseek_mobile
node scripts/install-desktop.mjs --manual
```

`--manual` packs `awbuilds-dsh-pocket-0.0.4.tgz`, adds the dependency and bundle
to the Desktop profile with a backup, and runs the app's bundled pnpm. Reopen the
app afterward. This is a manifest-level fallback; the in-app Plugins page is the
supported path.

`node scripts/install-desktop.mjs` without `--manual` only prints the in-app
steps; it never calls the blocked CLI for the Desktop profile.

## Build from source (optional)

```bash
git clone https://github.com/awbuilds/dsh-pocket.git
cd dsh-pocket
pnpm install
pnpm build
pnpm test
```

`pnpm build` writes `packages/dsh-pocket/lib/index.js` and `lib/client.js`. The
npm package and release tarball already contain both; build only if you are
developing or installing the local directory.

## First pairing

1. At the bottom of the left sidebar, click **Link phone**. A dialog shows a QR
   code, a six-digit code, and the reachable LAN addresses.
2. Scan the QR with the phone's camera. The pairing page fills in the code and
   opens the app. If the scan did not carry the code, enter the six digits.
3. The first launch may prompt for the macOS firewall; allow it.

Over plain HTTP, iOS **Add to Home Screen** still works; Chrome's install prompt
and service workers require TLS. Configure `tlsCertFile`/`tlsKeyFile` for full
PWA installability.

The gateway binds all interfaces by default. To restrict it to one Wi-Fi address,
set `bindHost: 192.168.x.y` in the `pocket` row; the dialog then advertises only
that address.

The phone stays paired for 30 days. **Revoke devices** in the dialog invalidates
every phone immediately. Restarting the Mac/DSH does not require re-pairing.

## Update after a DSH upgrade

The bundle pins DSH `0.2.1-rc.5`. If the app updates, update
`packages/dsh-pocket/package.json`'s `@deepseek-ai/dsh` peer (and the matching
`@deepseek-ai/dsh-*` dev dependencies), rebuild, repack, and install the new
tarball from **Plugins** in the left sidebar. The plugin manager may offer a version
exemption instead; only accept it after checking that the slot and service APIs
used by this bundle are unchanged.

## Uninstall

Use **Plugins** in the left sidebar in the app and disable or remove
`@awbuilds/dsh-pocket`, then restart if asked. For a manifest-level removal,
quit the app and run:

```bash
node scripts/uninstall-desktop.mjs --manual
```

The gateway secret at `$DSH_HOME/pocket/gateway-session` is kept; delete the
`pocket` folder for a fresh gateway identity.

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

It creates `~/.dsh-pocket-dev/profiles/pocket-dev`, installs the plugin with the
matching CLI, and boots a host there. That home has no model credentials, so the
UI, pairing, and mobile surface work but chat requires a signed-in account. For a
real-data throwaway host, set `DSH_HOME` and quit the Desktop app first.
