/** Clean what a scanner read or a person typed: no control characters, trimmed. The database checks the barcode itself (sql/108). */
export function cleanCode(raw: string): string {
  return [...raw]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .trim();
}
