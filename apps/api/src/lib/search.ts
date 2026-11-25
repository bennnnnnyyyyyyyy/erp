import type { Context } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from '../env';

// Search on the server for long lists (Ben, 25 Nov 2026: invoices, bills, expenses and payments searched only the rows already
// loaded, so an older record "did not exist"). `?q=` is matched as "contains", case ignored, on the list's number and note and on
// the name of its customer, supplier or category. No SQL needed: PostgREST filters with the caller's own sign-in (row level security).

/** The `?q=` text, safe inside a PostgREST filter string: at most 60 characters, without , ( ) * % \ " ' and line breaks. */
export function searchText(c: Context<AppEnv>): string {
  return (c.req.query('q') ?? '')
    .replace(/[,()*%\\"'\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** The PostgREST "contains" pattern for a search text (`*` is PostgREST's wildcard inside `or()`). */
export const contains = (q: string) => `*${q}*`;

/** Ids of this company's rows in `table` whose `column` contains the text (at most 200: enough to narrow a list). */
export async function idsMatching(db: SupabaseClient, table: string, column: string, orgId: string, q: string): Promise<string[]> {
  const { data, error } = await db.from(table).select('id').eq('org_id', orgId).ilike(column, `%${q}%`).limit(200);
  if (error) throw error;
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/** An `or()` filter: any of the text columns contains q, or the id column is one of the matching ids. */
export function orFilter(q: string, textColumns: string[], idColumns: [string, string[]][] = []): string {
  const parts = textColumns.map((col) => `${col}.ilike.${contains(q)}`);
  for (const [col, ids] of idColumns) if (ids.length) parts.push(`${col}.in.(${ids.join(',')})`);
  return parts.join(',');
}
