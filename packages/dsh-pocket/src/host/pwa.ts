/**
 * PWA surface owned by the gateway: a standalone manifest, the icons iOS and
 * Android ask for by fixed paths, and the index transforms that make the
 * proxied page installable and safe-area aware.
 *
 * The upstream index is otherwise untouched. These are additive meta tags, so
 * the same page behaves exactly as before on a desktop browser.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const ASSET_ROOT = new URL('../assets/', import.meta.url)

/** Icon routes the gateway answers itself, before proxying. */
export const ICON_ROUTES: Readonly<Record<string, string>> = {
  '/apple-touch-icon.png': 'apple-touch-icon.png',
  '/icon-192.png': 'icon-192.png',
  '/icon-512.png': 'icon-512.png',
}

/** Manifest served at `/manifest.webmanifest`. */
export const MANIFEST_PATH = '/manifest.webmanifest'

const iconCache = new Map<string, Promise<Buffer>>()

/** Load one icon from the package's `assets` directory. */
export function readIcon(asset: string): Promise<Buffer> {
  const cached = iconCache.get(asset)
  if (cached !== undefined) return cached
  const promise = readFile(fileURLToPath(new URL(asset, ASSET_ROOT)))
  iconCache.set(asset, promise)
  return promise
}

/** The installable web-app manifest. */
export function renderManifest(): string {
  return JSON.stringify(
    {
      name: 'DSH Pocket',
      short_name: 'Pocket',
      description: 'Remote control for DeepSeek Harness on your local network.',
      start_url: './',
      scope: './',
      display: 'standalone',
      orientation: 'any',
      background_color: '#0b0f14',
      theme_color: '#0b0f14',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  )
}

const VIEWPORT_META =
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'

const MOBILE_HEAD = [
  VIEWPORT_META,
  '<meta name="dsh-pocket" content="1" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="DSH Pocket" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  '<link rel="manifest" href="/manifest.webmanifest" />',
].join('\n    ')

/**
 * Add the mobile viewport and install metadata to an index document.
 * @param html - the upstream index body.
 * @returns the transformed body; already-transformed input is returned unchanged.
 */
export function transformIndex(html: string): string {
  if (html.includes('name="dsh-pocket"')) return html

  const viewport = /<meta[^>]*name=["']viewport["'][^>]*>/iu
  let next = html.replace(viewport, VIEWPORT_META)
  if (next.includes('name="viewport"') === false) next = next.replace(/<\/head>/iu, `    ${VIEWPORT_META}\n  </head>`)

  // The existing document already links ./manifest.webmanifest; replace it with
  // the gateway-owned absolute path so deep links install the same app.
  next = next.replace(/<link[^>]*rel=["']manifest["'][^>]*>/iu, '<link rel="manifest" href="/manifest.webmanifest" />')

  const extras = MOBILE_HEAD.split('\n')
    .filter((line) => line.includes(VIEWPORT_META) === false && line.includes('manifest') === false)
    .join('\n    ')
  if (/<\/head>/iu.test(next)) next = next.replace(/<\/head>/iu, `    ${extras}\n  </head>`)
  if (!/rel=["']manifest["']/iu.test(next)) {
    next = next.replace(/<\/head>/iu, '    <link rel="manifest" href="/manifest.webmanifest" />\n  </head>')
  }
  return next
}
