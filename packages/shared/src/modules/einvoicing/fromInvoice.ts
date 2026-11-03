// Maps our own customer invoice (integer minor units, item and customer master data) onto the ETA document input. Pure: the API
// loads the rows, this function shapes them, then buildDocument computes and serializes. Everything the mapping cannot fill is
// reported as an issue in plain words instead of guessed.
//
// Not supported yet, on purpose: invoices in a currency other than EGP. ETA wants the unit price in EGP plus the amount sold and the
// bank exchange rate of the day; we do not store an exchange rate on invoices, so inventing one would produce a wrong tax document.

import type { AddressInput, DocKind, EtaDocInput } from './build';
import type { LineInput, TaxInput } from './calc';
import type { Issue } from './validate';

export type SourceTaxRate = { taxType: string; subType: string; rate: number | string };

export type SourceItem = {
  name: string;
  etaItemType: 'GS1' | 'EGS' | null;
  etaItemCode: string | null;
  etaUnitCode: string | null;
  defaultTaxRate: SourceTaxRate | null;
};

export type SourceLine = { item: SourceItem; qty: number | string; unitPriceMinor: number | bigint };

export type SourceParty = {
  taxIdType: 'B' | 'P' | 'F' | null;
  taxId: string | null;
  name: string;
  country: string | null;
  governate: string | null;
  regionCity: string | null;
  street: string | null;
  buildingNumber: string | null;
};

export type SourceCompany = {
  registrationNumber: string;
  legalName: string;
  activityCode: string;
  branch: { code: string; address: AddressInput };
};

export type SourceDocument = {
  kind: DocKind;
  version: '1.0' | '0.9';
  /** Our document number (becomes ETA's internalID). */
  number: string;
  /** UTC instant. */
  issuedAt: string;
  currency: string;
  company: SourceCompany;
  customer: SourceParty;
  lines: SourceLine[];
  /** ETA UUIDs of the original invoice(s) for a credit or debit note. */
  references?: string[];
  roundingPlaces?: number;
};

const fixedFromMinor = (minor: number | bigint): string => {
  const v = BigInt(minor);
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};

const rateText = (r: number | string): string => (typeof r === 'number' ? String(r) : r.trim());

export function toEtaInput(src: SourceDocument): { input: EtaDocInput | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const add = (code: string, path: string, message: string, severity: Issue['severity'] = 'error') => issues.push({ code, path, message, severity });

  if (src.currency !== 'EGP') {
    add('CURRENCY_NOT_SUPPORTED', 'currency', `This invoice is in ${src.currency}. E-invoicing supports EGP invoices only for now (ETA needs the bank exchange rate of the day, which is not stored).`);
    return { input: null, issues };
  }
  if (src.lines.length === 0) {
    add('NO_LINES', 'lines', 'The invoice has no lines.');
    return { input: null, issues };
  }

  const lines: LineInput[] = [];
  src.lines.forEach((l, i) => {
    const p = `lines[${i}]`;
    const it = l.item;
    if (!it.etaItemType || !it.etaItemCode) add('ITEM_CODE', p, `"${it.name}" has no ETA item code.`);
    if (!it.etaUnitCode) add('UNIT_TYPE', p, `"${it.name}" has no ETA unit code.`);
    const taxes: TaxInput[] = [];
    if (it.defaultTaxRate) {
      taxes.push({ taxType: it.defaultTaxRate.taxType, subType: it.defaultTaxRate.subType, rate: rateText(it.defaultTaxRate.rate) });
    } else {
      add('NO_TAX_RATE', p, `"${it.name}" has no default tax rate, so it would be sent with no tax. Set the rate (even 0 or exempt) on the item.`, 'warning');
    }
    lines.push({
      description: it.name,
      itemType: it.etaItemType ?? 'EGS',
      itemCode: it.etaItemCode ?? '',
      unitType: it.etaUnitCode ?? '',
      quantity: String(l.qty),
      unitPriceEGP: fixedFromMinor(l.unitPriceMinor),
      taxes,
    });
  });

  const c = src.customer;
  if (!c.taxIdType) add('CUSTOMER_TAX_IDENTITY', 'receiver', `Customer "${c.name}" has no tax identity (business, person or foreign).`);
  const receiverAddress: AddressInput | undefined =
    c.governate && c.regionCity && c.street && c.buildingNumber
      ? { country: c.country ?? 'EG', governate: c.governate, regionCity: c.regionCity, street: c.street, buildingNumber: c.buildingNumber }
      : undefined;

  const input: EtaDocInput = {
    kind: src.kind,
    version: src.version,
    issuer: { id: src.company.registrationNumber, name: src.company.legalName, branchId: src.company.branch.code, address: src.company.branch.address },
    receiver: {
      type: c.taxIdType ?? 'B',
      ...(c.taxId ? { id: c.taxId } : {}),
      ...(c.name ? { name: c.name } : {}),
      ...(receiverAddress ? { address: receiverAddress } : {}),
    },
    dateTimeIssued: src.issuedAt,
    taxpayerActivityCode: src.company.activityCode,
    internalId: src.number,
    ...(src.references ? { references: src.references } : {}),
    ...(src.roundingPlaces !== undefined ? { roundingPlaces: src.roundingPlaces } : {}),
    lines,
  };
  return { input, issues };
}
