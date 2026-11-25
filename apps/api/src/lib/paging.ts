import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { invalid } from './body';

// Paging for long lists (UX audit 20 Nov: requests, orders, ledger, journal and notifications stopped at 200-500 rows with no way to
// see older ones). A list keeps its page size; `?offset=N` skips the newest N rows, so a screen asks for the next page with the
// number of rows it already has. Row level security still decides which rows exist; paging only picks the window.

const MAX_OFFSET = 1_000_000;

/** The `[from, to]` rows for `.range()`: one page of `size` rows starting at `?offset=` (0 when absent). */
export function pageRange(c: Context<AppEnv>, size: number): [number, number] {
  const raw = c.req.query('offset');
  if (raw === undefined || raw === '') return [0, size - 1];
  if (!/^\d{1,7}$/.test(raw) || Number(raw) > MAX_OFFSET) invalid('offset must be a whole number of rows');
  const from = Number(raw);
  return [from, from + size - 1];
}

/**
 * Every row a query returns, 1000 at a time: PostgREST (supabase/config.toml max_rows) cuts any read at 1000 rows without saying so,
 * so the catalogue lists (items, stock, customers, suppliers, units) lost rows in bigger companies (input and speed audit, 25 Nov 2026).
 * The query must have a stable order. Stops at `cap` rows.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  cap = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** `fetchAllPages` with the `{ data, error }` shape of a single read, for routes that retry with fewer columns on an older database. */
export async function readAllPages(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ data: unknown[] | null; error: unknown }> {
  try {
    return { data: await fetchAllPages<unknown>(page), error: null };
  } catch (error) {
    return { data: null, error };
  }
}
