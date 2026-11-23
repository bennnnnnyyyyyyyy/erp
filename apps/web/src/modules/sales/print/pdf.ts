// The PDF is made in the person's browser (Ben, 23 Nov 2026): the browser draws the A4 page (so Arabic letters join correctly), the
// drawing becomes a picture, and the picture goes into an A4 PDF. A page longer than A4 is cut into A4 pages. Both libraries are MIT
// (html-to-image, jspdf) and load only when someone asks for a PDF. A server converter (Gotenberg) comes later, for automatic sends.

const A4_W_MM = 210;
const A4_H_MM = 297;

/** Waits until the page's fonts and pictures are ready, so the picture is not taken half-drawn. */
async function settled(el: HTMLElement): Promise<void> {
  await document.fonts?.ready;
  const imgs = [...el.querySelectorAll('img')];
  await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); }))));
}

/** A PDF file of the element (an A4 .print-sheet). */
export async function sheetToPdf(el: HTMLElement): Promise<Blob> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  await settled(el);
  const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: false });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const pxPerMm = canvas.width / A4_W_MM;
  const pageHeightPx = Math.floor(A4_H_MM * pxPerMm);
  const pages = Math.max(1, Math.ceil((canvas.height - 2) / pageHeightPx));
  for (let p = 0; p < pages; p++) {
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = Math.min(pageHeightPx, canvas.height - p * pageHeightPx);
    const ctx = slice.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, p * pageHeightPx, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
    if (p > 0) pdf.addPage('a4', 'portrait');
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, A4_W_MM, slice.height / pxPerMm, undefined, 'FAST');
  }
  return pdf.output('blob');
}

/** Saves a file in the browser. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A safe file name from a document number: "INV-2026-00001.pdf". */
export const pdfName = (number: string | null): string => `${(number ?? 'DRAFT').replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
