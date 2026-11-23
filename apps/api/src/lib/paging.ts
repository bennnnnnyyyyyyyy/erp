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
