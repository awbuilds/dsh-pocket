# Security policy

`dsh-pocket` exposes the loopback DeepSeek Harness web server to the local
network through a pairing-authenticated gateway. It is designed for a trusted
LAN, not for public internet exposure. See [docs/security.md](docs/security.md)
for the threat model and the v1 limits.

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting on this repository (**Security → Report a
vulnerability**) and include:

- the package version and DSH runtime version (`0.2.1-rc.5`);
- the operating system and network setup;
- impact and a minimal reproduction;
- whether a paired device, an unpaired LAN client, or a local process is the
  attacker.

You should receive an acknowledgement within 72 hours. Please allow time for a
fix and a release before public disclosure.

## In scope

- Pairing code generation, verification, expiry, and rate limiting.
- Device-cookie signing, authority binding, expiry, and revocation.
- Origin/CSRF checks on pairing, writes, and WebSocket upgrades.
- Gateway request routing, proxy header rewriting, and the `/pocket/*` boundary.
- Secret storage (credentials record or the mode-0600 fallback file).
- TLS configuration and the `Secure` cookie flag.

## Not in scope

- A paired device is trusted as the operator by design; it can approve tools,
  answer questions, and read the workspace.
- Running the plugin behind a public tunnel or on an untrusted Wi-Fi network
  without TLS.
- Vulnerabilities in DeepSeek Harness itself; report those to the DSH project.

## Supported versions

`0.0.4` against DSH `0.2.1-rc.5`. A DSH upgrade requires a rebuild against the
new runtime; older pairings may need re-pairing after a revocation.
