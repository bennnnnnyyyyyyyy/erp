import { currentLanguage, tr } from './i18n';

// Names in the person's language (UX audit 20 Nov, Arabic check: units, warehouse and item names stayed English in Arabic mode).
// Items (and warehouses, sql/105) keep an Arabic name next to the English one; in Arabic the Arabic name shows, else the English.
// Units are free text ("piece", "litre"); the common ones have an Arabic text in the dictionaries, others show as typed.

/** The record's Arabic name in Arabic mode when it has one, else its name. */
export function localName(r: { name: string; nameAr?: string | null } | null | undefined): string {
  if (!r) return '';
  return currentLanguage() === 'ar' && r.nameAr?.trim() ? r.nameAr.trim() : r.name;
}

/** A unit of measure for display. */
export const unitLabel = (uom: string | null | undefined): string => (uom ? tr(uom) : '');
