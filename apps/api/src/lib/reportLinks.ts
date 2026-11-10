import type { Bindings } from '../env';
import { toCsv } from './csv';
import { anonDb } from './db.public';
import { isMissingSchema } from './errors';

// Private report links (sql/070). The token is 32 random bytes as 64 hex characters; anything else is refused before the database is asked.
export const REPORT_TOKEN_RE = /^[0-9a-f]{64}$/;

type ReportData = { columns: string[]; rows: (string | number | null)[][] };

/** The CSV for a link's report, or null for every kind of refusal (missing, revoked, expired, module off): nothing is said about which. */
export async function reportLinkCsv(env: Bindings, token: string): Promise<string | null> {
  if (!REPORT_TOKEN_RE.test(token)) return null;
  const { data, error } = await anonDb(env).rpc('core_report_link_rows', { p_token: token });
  if (error) {
    if (isMissingSchema(error)) throw error; // code deployed before its database update: the app answers 503 not_set_up
    return null;
  }
  const d = data as ReportData | null;
  if (!d || !Array.isArray(d.columns) || !Array.isArray(d.rows)) return null;
  return toCsv(d.columns, d.rows);
}
