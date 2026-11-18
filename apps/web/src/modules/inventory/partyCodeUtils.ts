/** Only the codes of the given items, so the "Their code" column appears only when a line on the document has one (sql/099). */
export const codesFor = (codes: Map<string, string>, itemIds: (string | undefined)[]) =>
  new Map([...codes].filter(([itemId]) => itemIds.includes(itemId)));
