// ETA code tables used by the document builder. Source: the SDK's TaxTypes.json and TaxSubtypes.json (offline copy in
// documentation/reference/eta-sdk/2026-11-02/files/files/), read 2 Nov 2026. Codes are facts published by ETA; which rate or
// subtype applies to a product is tax law and is configured per company, never decided here.

export const TAX_SUBTYPES: Readonly<Record<string, readonly string[]>> = {
  T1: ['V001', 'V002', 'V003', 'V004', 'V005', 'V006', 'V007', 'V008', 'V009', 'V010'],
  T2: ['Tbl01'],
  T3: ['Tbl02'],
  T4: ['W001', 'W002', 'W003', 'W004', 'W005', 'W006', 'W007', 'W008', 'W009', 'W010', 'W011', 'W012', 'W013', 'W014', 'W015', 'W016'],
  T5: ['ST01'],
  T6: ['ST02'],
  T7: ['Ent01', 'Ent02'],
  T8: ['RD01', 'RD02'],
  T9: ['SC01', 'SC02'],
  T10: ['Mn01', 'Mn02'],
  T11: ['MI01', 'MI02'],
  T12: ['OF01', 'OF02'],
  T13: ['ST03'],
  T14: ['ST04'],
  T15: ['Ent03', 'Ent04'],
  T16: ['RD03', 'RD04'],
  T17: ['SC03', 'SC04'],
  T18: ['Mn03', 'Mn04'],
  T19: ['MI03', 'MI04'],
  T20: ['OF03', 'OF04'],
};

/** Taxable fees that feed the VAT and table-tax base: T5 to T12 (equation 4 in the validation rules page). */
export const TAXABLE_FEE_TYPES: ReadonlySet<string> = new Set(['T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12']);
/** Non-taxable fees: T13 to T20 (equation 5). */
export const NON_TAXABLE_FEE_TYPES: ReadonlySet<string> = new Set(['T13', 'T14', 'T15', 'T16', 'T17', 'T18', 'T19', 'T20']);
/** Fixed-amount types that must carry rate 0. */
export const FIXED_AMOUNT_TYPES: ReadonlySet<string> = new Set(['T3', 'T6']);

export const ITEM_TYPES = ['GS1', 'EGS'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export function taxTypeNumber(t: string): number {
  const m = /^T(\d{1,2})$/.exec(t);
  if (!m) throw new Error(`INVALID_TAX_TYPE: "${t}"`);
  return Number(m[1]);
}

export function isValidTaxPair(taxType: string, subType: string): boolean {
  return (TAX_SUBTYPES[taxType] ?? []).includes(subType);
}
