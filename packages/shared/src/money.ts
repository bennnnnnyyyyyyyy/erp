// Money is stored as integer minor units (cents) plus an ISO 4217 code, never as a float.
export type Money = { amountMinor: number; currency: string };

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF']);

export function minorUnitsFor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export function formatMoney(money: Money, locale = 'en-US'): string {
  const digits = minorUnitsFor(money.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(money.amountMinor / 10 ** digits);
}
