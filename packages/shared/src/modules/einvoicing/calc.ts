// Line and document arithmetic that reproduces ETA's own validation equations (offline copy: document-validation-rules.md,
// "Simple field Validator"). Checked against the SDK sample document: both of its lines and all of its totals come out
// to the cent (see einvoicing.test.ts). One rounding rule: after every equation, round half away from zero to 5 decimals.
//
//   salesTotal  = quantity * unit price (EGP)
//   discount    = salesTotal * rate / 100            (or the amount given when no rate)
//   netTotal    = salesTotal - discount
//   fees T5..T12 (taxable) and T13..T20 (non-taxable): amount = netTotal * rate / 100, or the fixed amount given
//   T3 (fixed table tax) and T6 (fixed stamp): rate 0, amount given
//   T2 = (netTotal + taxable fees + valueDifference + T3) * rate / 100
//   T1 = (T2 + netTotal + taxable fees + valueDifference + T3) * rate / 100
//   T4 (withholding) = (netTotal - itemsDiscount) * rate / 100
//   total       = netTotal + T1 + T2 + T3 + taxable fees + non-taxable fees - itemsDiscount - T4
//
// The T1 and total formulas on the SDK page repeat terms; the reading above is the one that reproduces the sample exactly.

import { FIXED_AMOUNT_TYPES, NON_TAXABLE_FEE_TYPES, TAXABLE_FEE_TYPES, taxTypeNumber } from './codes';
import { ZERO, mul, parseDec, pct, roundTo, type Dec } from './decimal';

export type TaxInput = {
  taxType: string;
  subType: string;
  /** Percentage, e.g. "14". Omit for a fixed-amount tax. */
  rate?: string;
  /** Fixed amount (T3, T6 and the "(amount)" subtypes of fees). Omit for a percentage tax. */
  amount?: string;
};

export type LineInput = {
  description: string;
  itemType: 'GS1' | 'EGS';
  itemCode: string;
  unitType: string;
  internalCode?: string;
  quantity: string;
  /** Unit price in EGP, up to 5 decimals. */
  unitPriceEGP: string;
  /** Present when the sale is in a foreign currency: the unit price in that currency and the rate used. */
  foreign?: { currency: string; amountSold: string; exchangeRate: string };
  discountRate?: string;
  discountAmount?: string;
  itemsDiscount?: string;
  valueDifference?: string;
  taxes: TaxInput[];
};

export type CalcTax = { taxType: string; subType: string; rate: Dec; amount: Dec };

export type CalcLine = {
  quantity: Dec;
  unitPriceEGP: Dec;
  salesTotal: Dec;
  discountRate: Dec;
  discountAmount: Dec;
  netTotal: Dec;
  itemsDiscount: Dec;
  valueDifference: Dec;
  totalTaxableFees: Dec;
  totalNonTaxableFees: Dec;
  taxes: CalcTax[];
  total: Dec;
};

export type CalcTotals = {
  totalSalesAmount: Dec;
  totalDiscountAmount: Dec;
  netAmount: Dec;
  totalItemsDiscountAmount: Dec;
  extraDiscountAmount: Dec;
  taxTotals: { taxType: string; amount: Dec }[];
  totalAmount: Dec;
};

const optDec = (s: string | undefined): Dec => (s === undefined || s === '' ? ZERO : parseDec(s));

/**
 * places is the rounding precision for every computed amount (default 2, as in the SDK sample and our 2-decimal minor units;
 * ETA accepts up to 5). Each computed amount is rounded before it is used in the next equation, exactly as the stated figures are.
 */
export function calcLine(input: LineInput, places = 2): CalcLine {
  const r = (v: Dec): Dec => roundTo(v, places);
  const quantity = parseDec(input.quantity);
  if (quantity <= 0n) throw new Error('INVALID_QUANTITY: quantity must be greater than 0');
  const unitPriceEGP = parseDec(input.unitPriceEGP);
  const salesTotal = r(mul(quantity, unitPriceEGP));

  const discountRate = optDec(input.discountRate);
  if (discountRate < 0n || discountRate > 100n * 100000n) throw new Error('INVALID_DISCOUNT_RATE: must be 0 to 100');
  let discountAmount: Dec;
  if (discountRate > 0n) {
    discountAmount = r(pct(salesTotal, discountRate));
    if (input.discountAmount !== undefined && parseDec(input.discountAmount) !== discountAmount) {
      throw new Error('DISCOUNT_MISMATCH: discountAmount does not equal salesTotal * discountRate');
    }
  } else {
    discountAmount = optDec(input.discountAmount);
  }
  if (discountAmount < 0n || discountAmount > salesTotal) throw new Error('INVALID_DISCOUNT: must be between 0 and salesTotal');
  const netTotal = salesTotal - discountAmount;
  const itemsDiscount = optDec(input.itemsDiscount);
  const valueDifference = optDec(input.valueDifference);

  const seen = new Set<string>();
  for (const t of input.taxes) {
    if (seen.has(t.taxType)) throw new Error(`DUPLICATE_TAX_TYPE: ${t.taxType} appears twice on one line`);
    seen.add(t.taxType);
  }

  // Step 1: fees and fixed amounts, which depend only on netTotal.
  const calculated = new Map<string, CalcTax>();
  for (const t of input.taxes) {
    const fixed = t.amount !== undefined;
    if (FIXED_AMOUNT_TYPES.has(t.taxType) && !fixed) throw new Error(`FIXED_AMOUNT_REQUIRED: ${t.taxType} needs an amount and rate 0`);
    if (fixed && t.rate !== undefined && parseDec(t.rate) !== 0n) throw new Error(`FIXED_AMOUNT_RATE: ${t.taxType} fixed amounts carry rate 0`);
    const isFee = TAXABLE_FEE_TYPES.has(t.taxType) || NON_TAXABLE_FEE_TYPES.has(t.taxType);
    if (t.taxType === 'T3' || isFee) {
      const rate = fixed ? ZERO : optDec(t.rate);
      const amount = fixed ? parseDec(t.amount as string) : r(pct(netTotal, rate));
      calculated.set(t.taxType, { taxType: t.taxType, subType: t.subType, rate, amount });
    }
  }
  const sumOf = (types: ReadonlySet<string>): Dec =>
    [...calculated.values()].filter((c) => types.has(c.taxType)).reduce((s, c) => s + c.amount, ZERO);
  const totalTaxableFees = sumOf(TAXABLE_FEE_TYPES);
  const totalNonTaxableFees = sumOf(NON_TAXABLE_FEE_TYPES);
  const t3 = calculated.get('T3')?.amount ?? ZERO;

  // Step 2: table tax, VAT, withholding, in dependency order.
  for (const t of input.taxes) {
    if (t.taxType !== 'T2') continue;
    const rate = optDec(t.rate);
    calculated.set('T2', { taxType: 'T2', subType: t.subType, rate, amount: r(pct(netTotal + totalTaxableFees + valueDifference + t3, rate)) });
  }
  const t2 = calculated.get('T2')?.amount ?? ZERO;
  for (const t of input.taxes) {
    if (t.taxType !== 'T1') continue;
    const rate = optDec(t.rate);
    calculated.set('T1', { taxType: 'T1', subType: t.subType, rate, amount: r(pct(t2 + netTotal + totalTaxableFees + valueDifference + t3, rate)) });
  }
  for (const t of input.taxes) {
    if (t.taxType !== 'T4') continue;
    const rate = optDec(t.rate);
    calculated.set('T4', { taxType: 'T4', subType: t.subType, rate, amount: r(pct(netTotal - itemsDiscount, rate)) });
  }
  for (const t of input.taxes) {
    if (!calculated.has(t.taxType)) throw new Error(`UNSUPPORTED_TAX_TYPE: ${t.taxType}`);
  }

  const taxes = input.taxes.map((t) => calculated.get(t.taxType) as CalcTax);
  const amt = (type: string): Dec => calculated.get(type)?.amount ?? ZERO;
  const total =
    netTotal + amt('T1') + amt('T2') + amt('T3') + totalTaxableFees + totalNonTaxableFees - itemsDiscount - amt('T4');

  return {
    quantity,
    unitPriceEGP,
    salesTotal,
    discountRate,
    discountAmount,
    netTotal,
    itemsDiscount,
    valueDifference,
    totalTaxableFees,
    totalNonTaxableFees,
    taxes,
    total,
  };
}

export function calcTotals(lines: CalcLine[], extraDiscountAmount: Dec = ZERO): CalcTotals {
  if (lines.length === 0) throw new Error('NO_LINES: a document needs at least one line');
  const sum = (f: (l: CalcLine) => Dec) => lines.reduce((s, l) => s + f(l), ZERO);
  const byType = new Map<string, Dec>();
  for (const l of lines) for (const t of l.taxes) byType.set(t.taxType, (byType.get(t.taxType) ?? ZERO) + t.amount);
  const taxTotals = [...byType.entries()]
    .sort((a, b) => taxTypeNumber(a[0]) - taxTypeNumber(b[0]))
    .map(([taxType, amount]) => ({ taxType, amount }));
  return {
    totalSalesAmount: sum((l) => l.salesTotal),
    totalDiscountAmount: sum((l) => l.discountAmount),
    netAmount: sum((l) => l.netTotal),
    totalItemsDiscountAmount: sum((l) => l.itemsDiscount),
    extraDiscountAmount,
    taxTotals,
    totalAmount: sum((l) => l.total) - extraDiscountAmount,
  };
}
