import { tr } from '../../../lib/i18n';

// A letterhead as a one-page PDF (invoice printing plan, step 1c "not built yet" item 2). The PDF is drawn in the person's browser with
// pdf.js (pdfjs-dist, Apache-2.0) and saved as a JPEG picture of the A4 page, so the database, the API and the print page stay as they are
// (the letterhead is still a picture, sql/103 limits). pdf.js is loaded only when someone picks a PDF, so it costs the rest of the app nothing.

/** A PDF larger than this is refused before it is read (a letterhead is small; this stops a huge file from freezing the page). */
export const LETTERHEAD_PDF_MAX_BYTES = 10 * 1024 * 1024;

/** Widths tried, in pixels across the page (A4 at about 150, 120 and 100 dots per inch), each with falling JPEG quality. */
const MAX_WIDTH = 1240;
const WIDTHS = [MAX_WIDTH, 992, 827];
const QUALITIES = [0.9, 0.8, 0.7, 0.6];

/**
 * The first picture that fits within maxChars, best first: the largest width at the best quality, then lower quality, then a smaller
 * width. Null when even the smallest is too large.
 */
export function fitDataUrl(encode: (width: number, quality: number) => string, maxChars: number): string | null {
  for (const width of WIDTHS) {
    for (const quality of QUALITIES) {
      const url = encode(width, quality);
      if (url && url.length <= maxChars) return url;
    }
  }
  return null;
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** The first and only page of a letterhead PDF, as a JPEG data: address of at most maxChars characters. */
export async function letterheadFromPdf(file: File, maxChars: number): Promise<string> {
  if (file.size > LETTERHEAD_PDF_MAX_BYTES) throw new Error(tr('The PDF is too large (more than 10 MB). Use a smaller file.'));
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  // A PDF is a file from outside: no forms (XFA) are drawn and no scripts in it are run (pdf.js 6 has no eval at all).
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    if ((e as Error)?.name === 'PasswordException') throw new Error(tr('The PDF has a password. Save it without a password and try again.'));
    throw new Error(tr('The PDF could not be read. Save it again as a PDF and try again.'));
  }
  try {
    if (doc.numPages !== 1) throw new Error(tr('The letterhead PDF must have one page. Save only the first page and try again.'));
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // Drawn once at the largest width; smaller widths are scaled copies of it.
    const big = document.createElement('canvas');
    const viewport = page.getViewport({ scale: MAX_WIDTH / base.width });
    big.width = Math.round(viewport.width);
    big.height = Math.round(viewport.height);
    await page.render({ canvas: big, viewport, background: '#ffffff' }).promise;

    const url = fitDataUrl((width, quality) => {
      if (width === big.width) return big.toDataURL('image/jpeg', quality);
      const small = document.createElement('canvas');
      small.width = width;
      small.height = Math.round((big.height * width) / big.width);
      const ctx = small.getContext('2d');
      if (!ctx) return '';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, small.width, small.height);
      ctx.drawImage(big, 0, 0, small.width, small.height);
      return small.toDataURL('image/jpeg', quality);
    }, maxChars);
    if (!url) throw new Error(tr('The letterhead is too detailed to store. Try a simpler PDF or a PNG or JPEG picture.'));
    return url;
  } finally {
    await task.destroy();
  }
}
