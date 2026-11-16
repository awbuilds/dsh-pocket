# Install

The plugin runs inside **DeepSeek Harness Desktop** and is selected through a
profile bundle. It is additive: it starts its own LAN listener and does not
reconfigure or replace the app's loopback web server.

## Prerequisites

- macOS with DeepSeek Harness Desktop 0.2.2-rc.1 (tested; the bundle accepts `>=0.2.1-rc.5`).
- Node.js 22 or newer and pnpm 9+ only if you build from source.
- The phone and the Mac on the same Wi-Fi/LAN, without guest-network client
  isolation.
- Permission to allow incoming connections for the app: **System Settings →
  Network → Firewall** on macOS, or an inbound TCP `7317` rule on Windows.

## Install from inside the app

The **Desktop profile is managed exclusively by the app**. DSH 0.2.1's CLI
rejects `dsh plugin --profile desktop` from a terminal, whether or not the app
is running. Use the app's own installer:

1. Open **Plugins** in the left sidebar in DeepSeek Harness and click **Add
   plugin**.
2. Provide one of:
   - the npm package `@awbuilds/dsh-pocket@0.0.7`, with **Registry** set to
     **Official npm registry**
   - the release tarball: `awbuilds-dsh-pocket-0.0.7.tgz`
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

`--manual` packs `awbuilds-dsh-pocket-0.0.7.tgz`, adds the dependency and bundle
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
and service workers require TLS. Configure `tlsCertFile`/`tlsKeyFile` and follow
[Install as a phone app](#install-as-a-phone-app-pwa) to serve an HTTPS gateway
the phone trusts.

The gateway binds all interfaces by default. To restrict it to one Wi-Fi address,
set `bindHost: 192.168.x.y` in the `pocket` row; the dialog then advertises only
that address.

The phone stays paired for 30 days. **Revoke devices** in the dialog invalidates
every phone immediately. Restarting the Mac/DSH does not require re-pairing.

## Install as a phone app (PWA)

Browsers only offer the install prompt over HTTPS. Over plain HTTP the phone can
add a bookmark, but it opens with the browser's address bar. To make it a
standalone app, serve the gateway over TLS with a certificate the phone trusts,
then install it from the browser.

### 1. Create a local CA and a server certificate

Any absolute path works; the example uses `~/.dsh/pocket/tls`. The certificate
must cover the LAN address the dialog advertises.

```bash
mkdir -p ~/.dsh/pocket/tls && cd ~/.dsh/pocket/tls

cat > ca.cnf <<'EOF'
[req]
distinguished_name=dn
x509_extensions=v3_ca
prompt=no
[dn]
CN=DSH Pocket Local CA
[v3_ca]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
EOF
openssl genrsa -out ca.key 2048
openssl req -x509 -new -key ca.key -days 3650 -sha256 -config ca.cnf -out ca.crt

LAN_IP=192.168.1.50   # replace with the address the Link phone dialog lists
cat > server.ext <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:$LAN_IP,IP:127.0.0.1,DNS:localhost
EOF
cat > server.cnf <<EOF
[req]
distinguished_name=dn
prompt=no
[dn]
CN=$LAN_IP
EOF
openssl genrsa -out server.key 2048
openssl req -new -key server.key -config server.cnf -out server.csr
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 825 -sha256 -extfile server.ext -out server.crt
```

### 2. Point the pocket row at the certificate

Add to the profile's `cordis.patch.yml`:

```yaml
- id: pocket
  config:
    tlsCertFile: /absolute/path/to/server.crt
    tlsKeyFile: /absolute/path/to/server.key
```

A patch entry replaces the row's `config` wholesale, so restate any other fields
you changed there; omitted fields take the plugin defaults, which match the
bundle's values. On Windows, use forward slashes in the paths
(`C:/Users/you/.dsh/pocket/tls/server.crt`) or JSON-escaped backslashes. Restart
DeepSeek Harness if the gateway does not reload on its own.

### 3. Trust the CA on the phone

Transfer `ca.crt` to the phone.

Android: **Settings → Security and privacy → More security settings →
Encryption & credentials → Install a certificate → CA certificate → Install
anyway**, then pick the file, and confirm it under **Trusted credentials →
User**. Newer Android rejects a CA opened from a file manager with "Can't
install CA certificates"; it has to go through Settings.

iOS: open `ca.crt` in Files to install the profile, then enable it under
**Settings → General → About → Certificate Trust Settings**.

### 4. Install the app

Open `https://<lan-ip>:7317/pair` and pair as usual. The address bar must show a
trusted padlock; if it warns, the CA is not trusted yet. Then use the browser
menu: **Install app** in Chrome, or **Add to Home screen** in Safari. Chrome
installs a WebAPK that opens without the address bar and keeps the pairing; some
browsers only create a shortcut that still opens inside the browser, so prefer
Chrome for the standalone app. On Samsung phones Chrome may ship disabled;
enable it in **Settings → Apps** first.

On Android 17, the browser also needs the **Nearby devices** permission before
it can load any LAN address; see [troubleshooting](troubleshooting.md).

## Update after a DSH upgrade

The bundle is tested against DSH `0.2.2-rc.1` and accepts `>=0.2.1-rc.5`. If a
future DSH release changes the slot or service APIs used here, update the
matching `@deepseek-ai/dsh-*` dev dependencies, rebuild, repack, and install the
new tarball from **Plugins**. The plugin manager may offer a version exemption
instead; only accept it after checking those APIs are unchanged.

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
- `http://<lan-ip>:7317/pair` loads on the phone (or `https://` when TLS is
  configured; `/healthz` returns the gateway status in both cases).
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
