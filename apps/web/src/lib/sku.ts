// Item codes in the company's own format (sql/075): a prefix and a number of digits, for example "ITM-" + 4 -> ITM-0001.

export type SkuFormat = { prefix: string; digits: number };

/** What the first code of a format looks like, shown while a person chooses it. */
export const previewSku = (prefix: string, digits: number): string => `${prefix.toUpperCase()}${'1'.padStart(digits, '0')}`;

/**
 * The codes that follow `first`, counting up in its trailing number and keeping its width: ("ITM-0008", 3) -> ITM-0008, ITM-0009, ITM-0010.
 * A code without a trailing number is returned as given for the first row and blank for the others.
 */
export function followingCodes(first: string, count: number): string[] {
  const m = /^(.*?)(\d+)$/.exec(first);
  if (!m) return Array.from({ length: count }, (_, i) => (i === 0 ? first : ''));
  const [, prefix, digits] = m as unknown as [string, string, string];
  const start = Number(digits);
  return Array.from({ length: count }, (_, i) => `${prefix}${String(start + i).padStart(digits.length, '0')}`);
}
