import type { DocPrintData } from '@erp/shared';
import type { Bindings } from '../env';
import { anonDb } from './db.public';
import { isMissingSchema } from './errors';

// Customer invoice links (sql/103). The token is 32 random bytes as 64 hex characters; anything else is refused before the database is
// asked. The database function is granted to anon and finds the company only through the token, so this needs no secret key.
export const INVOICE_TOKEN_RE = /^[0-9a-f]{64}$/;

/** The print data for a link, or null for every kind of refusal (missing, switched off, voided, module off): nothing is said about which. */
export async function invoiceLinkData(env: Bindings, token: string): Promise<DocPrintData | null> {
  if (!INVOICE_TOKEN_RE.test(token)) return null;
  const { data, error } = await anonDb(env).rpc('sal_doc_link_print', { p_token: token });
  if (error) {
    // Code deployed before its database update: the app answers 503 not_set_up. Thrown as an Error (with the code) so the app's error
    // handler sees it: a plain object thrown from a route is not caught as an error.
    if (isMissingSchema(error)) throw Object.assign(new Error(error.message), { code: error.code });
    return null;
  }
  const d = data as DocPrintData | null;
  if (!d || typeof d !== 'object' || !d.document || !Array.isArray(d.lines)) return null;
  return d;
}
