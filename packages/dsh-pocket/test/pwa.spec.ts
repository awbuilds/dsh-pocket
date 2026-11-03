import { describe, expect, it } from 'vitest'
import { renderManifest, transformIndex } from '../src/host/pwa.ts'

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="manifest" href="./manifest.webmanifest" />
    <title>DeepSeek Harness</title>
  </head>
  <body><div id="root"></div></body>
</html>`

describe('transformIndex', () => {
  it('adds a cover viewport, install metadata, and the absolute manifest', () => {
    const html = transformIndex(INDEX)
    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('name="dsh-pocket"')
    expect(html).toContain('apple-mobile-web-app-capable')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(html).toContain('href="/manifest.webmanifest"')
    expect(html).not.toContain('href="./manifest.webmanifest"')
    // The original title and root survive.
    expect(html).toContain('<title>DeepSeek Harness</title>')
    expect(html).toContain('<div id="root"></div>')
  })

  it('is idempotent', () => {
    const once = transformIndex(INDEX)
    expect(transformIndex(once)).toBe(once)
  })

  it('still adds a viewport when the source has none', () => {
    const html = transformIndex('<html><head><title>x</title></head><body></body></html>')
    expect(html).toContain('name="viewport"')
    expect(html).toContain('viewport-fit=cover')
  })
})

describe('renderManifest', () => {
  it('is valid JSON with standalone display and the served icons', () => {
    const manifest = JSON.parse(renderManifest()) as {
      display: string
      start_url: string
      icons: Array<{ src: string; sizes: string }>
    }
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('./')
    expect(manifest.icons.map((icon) => icon.src)).toContain('/icon-192.png')
    expect(manifest.icons.map((icon) => icon.sizes)).toContain('512x512')
  })
})
