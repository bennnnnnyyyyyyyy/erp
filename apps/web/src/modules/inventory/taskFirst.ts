// Pure helpers for the task-first Inventory screens (decision R1 A, 10 Nov 2026).

/** True when a cell shows nothing: no value, an empty or blank text. Zero is a value. */
export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * The columns that are empty in every row, so a table can leave them out (for example the Arabic name when no item has one).
 * `getters` maps a column key to the value shown in it. With no rows nothing is hidden: an empty table keeps its headings.
 */
export function emptyColumnKeys<T>(rows: readonly T[], getters: Record<string, (row: T) => unknown>): Set<string> {
  const out = new Set<string>();
  if (rows.length === 0) return out;
  for (const [key, get] of Object.entries(getters)) if (rows.every((r) => isBlank(get(r)))) out.add(key);
  return out;
}
