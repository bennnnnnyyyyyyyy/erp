// Units on order lines (master data slice D, sql/101, ADR-0006). A line is saved in the item's base unit (quantity in pieces, price per
// piece); it also remembers the unit it was typed in. This file turns what was typed ("3 box at 120.00") into what is saved
// ("36 piece at 10.00") and says when a box price does not split into whole minor units per piece.

export type ItemUnit = { itemId: string; unit: string; factor: number; forPurchase: boolean; forSale: boolean };
export type ItemDefaultUnits = { itemId: string; purchaseUnit: string | null; saleUnit: string | null };

/** Base units that are measures may hold decimals (1.5 kg); the same list as public.inv__unit_allows_decimals in sql/101. */
const DECIMAL_UNITS = new Set([
  'kg', 'kilo', 'kilogram', 'g', 'gram', 'gm', 'mg', 'ton', 'tonne', 't',
  'l', 'lt', 'ltr', 'litre', 'liter', 'ml', 'm', 'metre', 'meter', 'cm', 'mm', 'km', 'm2', 'sqm', 'm3', 'cbm',
  'كجم', 'كيلو', 'جم', 'جرام', 'لتر', 'مل', 'متر', 'سم',
]);
export const unitAllowsDecimals = (unit: string): boolean => DECIMAL_UNITS.has(unit.trim().toLowerCase());

export type BaseLine = {
  /** Quantity in the base unit, as saved (3 decimals). */
  baseQty: number;
  /** Price per base unit in minor units, as saved. */
  baseMinor: number;
  /** The line amount as saved (baseQty x baseMinor). */
  lineMinor: number;
  /** The line amount as typed (qty x price). Differs from lineMinor when the price per unit does not split evenly. */
  typedLineMinor: number;
  /** False when the base quantity is not whole and the base unit is not a measure (1.3 box of 12 = 15.6 pieces). */
  whole: boolean;
};

/** qty and price as typed in a unit of `factor` base units -> the saved line. factor 1 = the base unit. */
export function toBaseLine(qty: number, priceMinor: number, factor: number, baseUnit: string): BaseLine {
  const baseQty = Math.round(qty * factor * 1000) / 1000;
  const baseMinor = Math.round(priceMinor / factor);
  return {
    baseQty,
    baseMinor,
    lineMinor: Math.round(baseQty * baseMinor),
    typedLineMinor: Math.round(qty * priceMinor),
    whole: unitAllowsDecimals(baseUnit) || Number.isInteger(baseQty),
  };
}

/** "3 box (36 piece)" for a saved line; just "36 piece" when it was typed in the base unit. */
export function unitText(qty: number, baseUnit: string, unit: string | null | undefined, factor: number | null | undefined): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  if (!unit || !factor) return `${n(qty)} ${baseUnit}`;
  return `${n(qty / factor)} ${unit} (${n(qty)} ${baseUnit})`;
}
