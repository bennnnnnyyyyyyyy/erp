// The signer boundary (plan section 6.3). The Worker never holds a private key: it builds the document, computes the canonical
// digest, and asks a Signer for a CAdES-BES signature over it. Implementations (a local signing agent next to the customer's
// USB token, a hosted HSM service, a provider) are chosen later without changing anything else.
// `StubSigner` is for tests and for version 0.9 documents, where ETA does not validate signatures; it must never be used for 1.0.

import { canonicalize, utf8, webCryptoSha256, type Sha256 } from './serialize';
import { stringifyDoc, type DocObject } from './rawjson';

export type SignRequest = {
  /** UTF-8 bytes of the canonical serialization (what ETA hashes). */
  canonicalBytes: Uint8Array;
  /** SHA-256 of canonicalBytes. */
  digest: Uint8Array;
  /** The company this signature is for; a signer holds one certificate per company. */
  orgId: string;
};

export interface Signer {
  /** `real` only for a signer holding a company's eSeal/certificate. Production mode requires `real`; the stub is `stub`. */
  readonly kind: 'real' | 'stub';
  /** Returns the Base64 CAdES-BES structure to place in `signatures[0].value`. */
  sign(req: SignRequest): Promise<string>;
}

export class StubSigner implements Signer {
  readonly kind = 'stub' as const;
  async sign(): Promise<string> {
    return 'U1RVQi1TSUdOQVRVUkUtRk9SLVRFU1RTLU9OTFk='; // "STUB-SIGNATURE-FOR-TESTS-ONLY"
  }
}

/** Sign one document and return it with the issuer signature appended as the last property. */
export async function signDocument(
  doc: DocObject,
  orgId: string,
  signer: Signer,
  sha256: Sha256 = webCryptoSha256,
): Promise<DocObject> {
  if ('signatures' in doc) throw new Error('ALREADY_SIGNED');
  const canonicalBytes = utf8(canonicalize(doc));
  const digest = await sha256(canonicalBytes);
  const value = await signer.sign({ canonicalBytes, digest, orgId });
  return { ...doc, signatures: [{ signatureType: 'I', value }] };
}

/** The text that is actually sent: identical number text to the text that was signed. */
export function documentJson(doc: DocObject): string {
  return stringifyDoc(doc);
}
