import type { CbeRate } from '@erp/shared';
import { HttpError } from '../errors';

// Central Bank of Egypt exchange rates (INTEGRATIONS_PLAN.md: RateSource, stage F). SIMULATED ONLY for now (Ben, 9 Nov 2026).
//
// The CBE publishes a buy and a sell rate per currency in Egyptian pounds. Until the live source is chosen (what the CBE offers, and
// which rate the company books at: decision 8 in INTEGRATIONS_PLAN §11), the simulator answers in the same shape from the daily mid
// rate we already store (Frankfurter, sql/053), with a fixed spread either side. Rules for simulated rates:
//   * every rate says simulated: true and the screens label it SIMULATED;
//   * they are worked out on request and NEVER saved to core_fx_rates, so core_fx_rate can never convert anything with them.

/** The currencies the CBE table shows first, in this order. */
export const CBE_CURRENCIES = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'CHF', 'JPY', 'CNY'] as const;

/** Half the gap between the simulated buy and sell rates, as a fraction of mid (0.25% each side). */
export const CBE_SIMULATED_SPREAD = 0.0025;

export type MidRate = { currency: string; mid: number; rateDate: string };
export type CbeMode = 'simulated' | 'live';

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Simulated CBE rates from mid rates (EGP per unit). Skips anything that is not a sane positive number or a proper currency code. */
export function simulateCbe(mids: MidRate[]): CbeRate[] {
  const out: CbeRate[] = [];
  for (const m of mids) {
    if (!/^[A-Z]{3}$/.test(m.currency) || m.currency === 'EGP' || !Number.isFinite(m.mid) || m.mid <= 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.rateDate)) continue;
    out.push({
      currency: m.currency,
      buy: round4(m.mid * (1 - CBE_SIMULATED_SPREAD)),
      sell: round4(m.mid * (1 + CBE_SIMULATED_SPREAD)),
      mid: round4(m.mid),
      rateDate: m.rateDate,
      simulated: true,
    });
  }
  return out;
}

/** The rate source. Live is not built: it refuses rather than guess. */
export function cbeRates(mode: CbeMode, mids: MidRate[]): CbeRate[] {
  if (mode !== 'simulated') {
    throw new HttpError(501, 'Live Central Bank of Egypt rates are not available yet', 'not_available');
  }
  return simulateCbe(mids);
}
