import type { Bindings } from '../env';
import { adminDb } from '../lib/db.admin';

// Daily exchange rates (INTEGRATIONS_PLAN.md wave 1; sql/053 core_fx_rates). Frankfurter publishes free, keyless mid-market rates
// from central banks (documentation/reference/02-exchange-rates). We store rates against USD once a day; core_fx_rate crosses any pair.
// Runs from the scheduled handler; it fetches at most every 6 hours (the cron runs every 5 minutes), and a failure only logs.

export const FX_SOURCE = 'frankfurter';
export const FX_URL = 'https://api.frankfurter.dev/v2/rates?base=USD';
const REFRESH_MS = 6 * 60 * 60 * 1000;

type FxRecord = { date: string; base: string; quote: string; rate: number };

/** Groups Frankfurter's records ({date, base, quote, rate}) by date into {date: {QUOTE: rate}}, USD base only, sane values only. */
export function groupRates(records: unknown): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (!Array.isArray(records)) return out;
  for (const r of records as Partial<FxRecord>[]) {
    if (
      !r ||
      r.base !== 'USD' ||
      typeof r.quote !== 'string' ||
      !/^[A-Z]{3}$/.test(r.quote) ||
      typeof r.rate !== 'number' ||
      !Number.isFinite(r.rate) ||
      r.rate <= 0 ||
      typeof r.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.date)
    )
      continue;
    const day = out.get(r.date) ?? {};
    day[r.quote] = r.rate;
    out.set(r.date, day);
  }
  return out;
}

export async function runFxPass(env: Bindings, fetchImpl: typeof fetch = fetch): Promise<{ skipped: boolean; saved: number }> {
  const client = adminDb(env);
  const { data: last, error } = await client
    .from('core_fx_rates')
    .select('fetched_at')
    .eq('source', FX_SOURCE)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ fetched_at: string }>();
  if (error) throw new Error(error.message);
  if (last && Date.now() - new Date(last.fetched_at).getTime() < REFRESH_MS) return { skipped: true, saved: 0 };

  const res = await fetchImpl(FX_URL, { headers: { Accept: 'application/json', 'User-Agent': 'erp-worker' } });
  if (!res.ok) throw new Error(`Frankfurter returned ${res.status}`);
  let saved = 0;
  for (const [date, rates] of groupRates(await res.json())) {
    const r = await client.rpc('core__save_fx_rates', { p_date: date, p_base: 'USD', p_rates: rates, p_source: FX_SOURCE });
    if (r.error) throw new Error(r.error.message);
    saved += Number(r.data ?? 0);
  }
  return { skipped: false, saved };
}
