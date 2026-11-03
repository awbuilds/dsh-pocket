# Security model

`dsh-pocket` is a trusted-LAN remote control for one operator. It is not a
multi-user server, and it is not designed for public internet exposure in v1.

## Trust boundaries

```
phone ── gateway (0.0.0.0:7317) ── loopback DSH server (127.0.0.1:random)
        │ pairing + device cookie
        │ loopback-only /pocket/* control routes
```

- The DSH web server stays on loopback. Only the gateway listens on the LAN.
- The gateway is the authentication boundary. It does not rely on the DSH
  launcher URL being secret.
- Static app assets and the pairing page are served by the gateway; everything
  except `/pair`, `/healthz`, the manifest, and the icons requires the gateway
  device cookie.

## Pairing

1. The Desktop dialog asks the loopback control route for a fresh six-digit
   code. Codes are generated with `crypto.randomInt`, rotate on success and on
   expiry, and live for 300 seconds by default.
2. The QR embeds the code in the URL **fragment** (`/pair#123456`), so the code
   is not sent in an HTTP request line or server log. The pairing page reads the
   fragment, clears it from the address bar, and posts it once.
3. The gateway compares the code with a constant-time comparison and accepts one
   attempt per code.
4. Per-address brute-force limits (10 failures per 5 minutes by default, then a
   15-minute lockout) and a process-wide failure limit apply. `/pair` and the
   submission endpoint are also rate-limited.
5. Success issues a signed `HttpOnly` cookie (`SameSite=Lax`, 30 days,
   `Secure` when the gateway serves TLS). The cookie is an HMAC over
   `{issuedAt, expiresAt, deviceId}` with a 32-byte secret.

The secret lives in the DSH credential record
`dsh-pocket/gateway-session` when the credentials service is available, and
otherwise in `$DSH_HOME/pocket/gateway-session` with mode `0600`.

## Request protections

- **Origin checks:** state-changing requests and WebSocket upgrades require an
  `Origin` that matches one of the gateway's current origins, or no `Origin` for
  non-browser clients. `Sec-Fetch-Site: cross-site` is refused.
- **No `/pocket/*` through the gateway:** the loopback control routes return 404
  from the LAN. A paired phone cannot mint another device's code or revoke
  devices.
- **Upstream fence:** the proxy rewrites `Host` to the loopback authority and
  strips `Origin`, `Referer`, `Sec-Fetch-*`, and `X-Forwarded-*`, which satisfies
  the DSH browser-trust fence. Those headers are not a second security layer
  after the gateway has admitted the request.
- **Frame/clickjacking:** HTML responses carry `X-Frame-Options: SAMEORIGIN`; the
  pairing page additionally uses `DENY`.
- **No secrets in logs:** the launcher token, cookies, and pairing codes are
  never logged. `/healthz` returns only listener state.

## Plain HTTP (v1 default)

HTTP on the LAN means the device cookie and message content are visible to
someone who can observe the Wi-Fi traffic (for example, on an open network).
Use it only on a network you trust. The pairing dialog says "plain HTTP" when
TLS is off.

To enable TLS, generate a certificate whose subject alternative name covers the
IP you open (mkcert is the simplest local option), then set the two paths in the
profile patch:

```yaml
- id: pocket
  config:
    tlsCertFile: /absolute/path/to/cert.pem
    tlsKeyFile: /absolute/path/to/key.pem
```

The gateway serves HTTPS only; there is no HTTP redirect listener. The phone
must trust the certificate (install the mkcert root CA on the phone once). When
TLS is active the gateway cookie gains `Secure`. The upstream DSH listener stays
HTTP on loopback; its cookie is therefore not marked `Secure` even though the
browser receives it over the gateway's TLS connection.

## Revocation and lifetime

- **Revoke devices** in the dialog rotates the gateway secret immediately; every
  paired cookie becomes invalid and devices are sent back to `/pair`.
- A paired cookie lasts 30 days (`cookieMaxAgeDays`).
- The DSH browser cookie can outlive a gateway revocation, but it is unreachable
  once the gateway cookie is gone. To revoke those too, delete the
  `client-connection/browser-session` credential and restart DSH.
- There is no per-device list (cookies are stateless), so revocation is
  all-devices by design.

## Network scope

The gateway binds `0.0.0.0` by default, which includes VPN and secondary interfaces. Set `bindHost` to a single LAN literal when the Mac has interfaces you do not want to expose. The dialog's address list comes from the same interface enumeration, so it advertises exactly what it can use.

## Explicit non-goals

- Public exposure or a public tunnel. The gateway has no account system, no
  per-device ACL, and no audit log.
- Multi-user operation. Every paired device speaks for the same operator and
  can approve tools, answer questions, and read the workspace.
- Protecting the Mac from a malicious paired device. Pairing is equivalent to
  handing someone the Mac's operator session.
