// ETA canonical serialization (official page "Document serialization approach", JSON variant) and the hash that is signed.
// Tested against the SDK's own sample (one-doc.json -> one-doc-serialized.json.txt), byte for byte.
//
// Rules: start at the document root (not the submission); property names upper-cased with the invariant culture; values taken
// exactly as written; names and simple values wrapped in double quotes; for an array, the array name appears once before the
// array and again before every element. The `signatures` element is not part of the signed content.

import { RawNumber, type DocObject, type DocValue } from './rawjson';

function simple(v: DocValue): string {
  if (typeof v === 'string') return `"${v}"`;
  if (v instanceof RawNumber) return `"${v.text}"`;
  if (typeof v === 'boolean') return `"${v ? 'true' : 'false'}"`;
  throw new Error('SERIALIZE: null is not a valid document value');
}

function serializeValue(v: DocValue): string {
  if (Array.isArray(v) || (typeof v === 'object' && v !== null && !(v instanceof RawNumber))) {
    return serializeObject(v as DocObject);
  }
  return simple(v);
}

function serializeObject(o: DocObject): string {
  let out = '';
  for (const [name, value] of Object.entries(o)) {
    const upper = `"${name.toUpperCase()}"`;
    if (Array.isArray(value)) {
      out += upper;
      for (const el of value) out += upper + serializeValue(el);
    } else {
      out += upper + serializeValue(value);
    }
  }
  return out;
}

/** The canonical string to hash. `doc` is one document (not the submission); any `signatures` property is ignored. */
export function canonicalize(doc: DocObject): string {
  const { signatures: _omit, ...rest } = doc;
  return serializeObject(rest);
}

export type Sha256 = (bytes: Uint8Array) => Promise<Uint8Array>;

/** SHA-256 through Web Crypto (available in Cloudflare Workers, browsers and Node 22). */
export const webCryptoSha256: Sha256 = async (bytes) => {
  const subtle = (globalThis as unknown as { crypto: { subtle: { digest(a: string, d: Uint8Array): Promise<ArrayBuffer> } } })
    .crypto.subtle;
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
};

// The shared package targets ES2022 without DOM or Node typings; TextEncoder exists in Workers, browsers and Node.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The 32-byte digest that the signer signs, for one document. */
export async function documentDigest(doc: DocObject, sha256: Sha256 = webCryptoSha256): Promise<Uint8Array> {
  return sha256(utf8(canonicalize(doc)));
}
