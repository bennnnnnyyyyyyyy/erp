import { useEffect, useState } from 'react';

// The QR code on a printed document (SCANNING_PLAN.md step 4): a link into the app (lib/docLink.ts). Drawn as SVG by ZXing's QR writer
// (@zxing/browser, MIT; the encoder is @zxing/library, Apache-2.0), loaded only when a document is shown, so it stays out of the main
// bundle. While it is drawing, the box carries data-qr="pending" and the PDF waits for it (pdf.ts).

/** The QR code as SVG markup: black modules on white, sized by CSS, the standard quiet zone kept. */
async function qrSvg(text: string): Promise<string> {
  const { BrowserQRCodeSvgWriter } = await import('@zxing/browser');
  const svg = new BrowserQRCodeSvgWriter().write(text, 0, 0);
  const w = svg.getAttribute('width') ?? '0';
  const h = svg.getAttribute('height') ?? '0';
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  return svg.outerHTML;
}

export function DocQr({ text, label }: { text: string; label: string }) {
  const [markup, setMarkup] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setMarkup(null);
    qrSvg(text)
      .then((m) => live && setMarkup(m))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [text]);
  if (failed) return null;
  return (
    <figure className="print-app-qr" data-qr={markup ? 'ready' : 'pending'}>
      {/* The markup is ZXing's own SVG of the link (rectangles only), never text from a user. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: generated SVG, see above */}
      <div className="print-app-qr-code" role="img" aria-label={label} dangerouslySetInnerHTML={markup ? { __html: markup } : undefined} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
