import { formatMoney } from '@erp/shared';

/** Big headline figures: whole currency units ("EGP 14,974,593"), so they fit a card. Tables and forms keep the exact amount (formatMoney). */
export function formatWhole(amountMinor: number, currency: string): string {
  return formatMoney({ amountMinor: Math.round(amountMinor / 100) * 100, currency }).replace(/\.0+(?=\D*$)/, '');
}