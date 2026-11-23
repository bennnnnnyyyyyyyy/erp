// Files people upload (scanning, sql/108): pictures and PDFs of bills and other records. Checks the real first bytes, not only the
// declared type, and gives the fingerprint. Pure: no storage, no database.

export const MAX_UPLOAD = 10 * 1024 * 1024;
export type UploadMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
export const UPLOAD_EXT: Record<UploadMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** The type the first bytes show (JPEG, PNG, WebP or PDF), or null for anything else. */
export function sniffMime(bytes: ArrayBuffer): UploadMime | null {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = String.fromCharCode(...b);
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('%PDF')) return 'application/pdf';
  return null;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}
