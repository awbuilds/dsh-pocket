/**
 * QR rendering for the pairing dialog. The encoder is bundled, so the dialog
 * works with no network and no third-party image request.
 */
import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/** Render one payload as an inline SVG QR code. */
export function QrCode({ text, size = 240 }: { text: string; size?: number }): React.JSX.Element | null {
  const markup = useMemo(() => {
    if (text === '') return ''
    try {
      const qr = qrcode(0, 'M')
      qr.addData(text)
      qr.make()
      return qr.createSvgTag({ scalable: true, margin: 1 })
    } catch {
      return ''
    }
  }, [text])

  if (markup === '') return null
  return (
    <div className="pocket-qr" style={{ maxWidth: size }} aria-label="Pairing QR code">
      {/* The encoder returns a self-contained SVG string; no user input is interpolated into it. */}
      <div dangerouslySetInnerHTML={{ __html: markup }} />
    </div>
  )
}
