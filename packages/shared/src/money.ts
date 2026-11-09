// Money is stored as integer minor units (cents) plus an ISO 4217 code, never as a float.
export type Money = { amountMinor: number; currency: string };

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF']);

export function minorUnitsFor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export function formatMoney(money: Money, locale = 'en-US'): string {
  const digits = minorUnitsFor(money.currency);
  const amount = money.amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: money.currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    // An unknown or half-typed code must never take a screen down: show the number and the code as given.
    return `${amount.toFixed(digits)} ${money.currency}`.trim();
  }
}
