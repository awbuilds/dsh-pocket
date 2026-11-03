/**
 * The unauthenticated pairing page the gateway serves at `/pair`.
 *
 * It carries everything inline — no external fonts, scripts, or images — so it
 * works before the device has any credential and cannot be used to probe the
 * app's asset routes. A code in the URL fragment is auto-submitted and cleared
 * from the bar, which is what a QR scan produces.
 */

/** Render the static pairing page. */
export function renderPairPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<title>Connect to DeepSeek Harness</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #ffffff; --fg: #11151a; --muted: #5c6673; --line: #e3e6ea; --accent: #2f6bff; --danger: #c0392b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0f14; --card: #141a21; --fg: #e8edf3; --muted: #9aa6b2; --line: #26303a; --accent: #6f9bff; --danger: #ff7b6b; } }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.45 -apple-system, BlinkMacSystemFont, "SF Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: grid; place-items: center; padding: max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom)); }
  main { width: min(420px, 100%); background: var(--card); border: .5px solid var(--line); border-radius: 18px; padding: 28px 24px; box-shadow: 0 12px 40px rgb(0 0 0 / .08); }
  .mark { width: 46px; height: 46px; border-radius: 13px; background: var(--fg); color: var(--card); display: grid; place-items: center; font-weight: 700; font-size: 18px; letter-spacing: -.02em; }
  h1 { font-size: 21px; line-height: 1.25; margin: 18px 0 6px; letter-spacing: -.01em; }
  p { margin: 0 0 18px; color: var(--muted); font-size: 14.5px; }
  label { display: block; font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 8px; }
  input { width: 100%; padding: 14px 16px; font-size: 24px; letter-spacing: .32em; text-align: center; font-variant-numeric: tabular-nums; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 12px; outline: none; }
  input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
  button { width: 100%; margin-top: 14px; padding: 14px 16px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font-size: 16px; font-weight: 650; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .status { min-height: 22px; margin-top: 12px; font-size: 13.5px; color: var(--danger); }
  .hint { margin-top: 18px; padding-top: 16px; border-top: .5px solid var(--line); font-size: 12.5px; color: var(--muted); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); border: .5px solid var(--line); border-radius: 6px; padding: 1px 5px; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">DSH</div>
  <h1>Connect this device</h1>
  <p>Enter the six-digit code shown in DeepSeek Harness on your Mac. Scanning the QR code fills it in for you.</p>
  <form id="pair-form" novalidate>
    <label for="code">Pairing code</label>
    <input id="code" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" placeholder="000000" aria-describedby="status" />
    <button id="submit" type="submit">Connect</button>
    <div id="status" class="status" role="status" aria-live="polite"></div>
  </form>
  <div class="hint">This device stays connected for 30 days. You can revoke it from <strong>Link phone</strong> on the Mac at any time. The page is served over your local network only.</div>
</main>
<script>
(() => {
  const form = document.getElementById('pair-form');
  const input = document.getElementById('code');
  const button = document.getElementById('submit');
  const status = document.getElementById('status');
  let busy = false;

  function show(message) { status.textContent = message || ''; }
  function readFragment() {
    const raw = (location.hash || '').replace(/^#/, '').trim();
    return /^\\d{6}$/.test(raw) ? raw : '';
  }
  async function pair(code) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    show('');
    try {
      const response = await fetch('/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (response.status === 204) {
        location.replace('/');
        return;
      }
      let message = 'That code was not accepted.';
      try {
        const body = await response.json();
        if (body && typeof body.message === 'string' && body.message !== '') message = body.message;
      } catch {}
      if (response.status === 429) message = 'Too many attempts. Wait a few minutes, then ask the Mac for a new code.';
      if (response.status === 401 && message === 'That code was not accepted.') message = 'That code is wrong or has expired. Ask the Mac for a fresh code.';
      show(message);
      input.select();
    } catch {
      show('Could not reach DeepSeek Harness. Check that this device is on the same Wi-Fi.');
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  const code = readFragment();
  if (code !== '') {
    input.value = code;
    history.replaceState(null, '', '/pair');
    pair(code);
  }
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\\D/g, '').slice(0, 6);
    show('');
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!/^\\d{6}$/.test(value)) { show('Enter all six digits.'); return; }
    pair(value);
  });
  if (code === '') input.focus();
})();
</script>
</body>
</html>
`
}
