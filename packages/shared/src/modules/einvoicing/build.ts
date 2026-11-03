// Builds the ETA document (invoice, credit note, debit note) from a neutral input. Property names and order follow ETA's own
// working examples (the SDK Postman collection and one-doc.json), which differ in casing from the field tables:
// `internalID`, `branchID`, `documentType` "I" / "C" / "D", `signatureType`. See ETA_EINVOICING_PLAN.md section 3.3.
// Every number is written as exact text (RawNumber) so the text that is signed equals the text that is sent.
// The builder never signs: it returns the unsigned document; see signer.ts.

import { calcLine, calcTotals, type CalcLine, type CalcTotals, type LineInput } from './calc';
import { fmtDec, parseDec, ZERO } from './decimal';
import { num, stringifyDoc, type DocObject, type DocValue } from './rawjson';

export type AddressInput = {
  country: string; // ISO 3166 alpha-2, "EG" for Egypt
  governate: string;
  regionCity: string;
  street: string;
  buildingNumber: string;
  postalCode?: string;
  floor?: string;
  room?: string;
  landmark?: string;
  additionalInformation?: string;
};

export type IssuerInput = {
  /** Registration number. */
  id: string;
  name: string;
  /** Branch code as registered with ETA; mandatory for a business issuer. */
  branchId: string;
  address: AddressInput;
};

export type ReceiverInput = {
  type: 'B' | 'P' | 'F';
  id?: string;
  name?: string;
  address?: AddressInput;
};

export type DocKind = 'invoice' | 'credit' | 'debit';

export type EtaDocInput = {
  kind: DocKind;
  /** "1.0" validates signatures; "0.9" does not (useful for early PreProd tests). */
  version: '1.0' | '0.9';
  issuer: IssuerInput;
  receiver: ReceiverInput;
  /** UTC instant, e.g. 2026-11-02T10:15:00Z. Must not be in the future. */
  dateTimeIssued: string;
  taxpayerActivityCode: string;
  /** Our own document number. */
  internalId: string;
  /** ETA UUIDs of the invoices a credit or debit note refers to. */
  references?: string[];
  purchaseOrderReference?: string;
  purchaseOrderDescription?: string;
  salesOrderReference?: string;
  salesOrderDescription?: string;
  proformaInvoiceNumber?: string;
  lines: LineInput[];
  extraDiscountAmount?: string;
  /** Rounding precision for computed amounts, 2 (default) to 5. */
  roundingPlaces?: number;
};

export const DOCUMENT_TYPE_CODE: Record<DocKind, string> = { invoice: 'I', credit: 'C', debit: 'D' };

export type BuiltDocument = { doc: DocObject; lines: CalcLine[]; totals: CalcTotals };

function putOptional(target: DocObject, key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') target[key] = value;
}

function addressObject(a: AddressInput, branchId?: string): DocObject {
  const o: DocObject = {};
  if (branchId !== undefined) o.branchID = branchId;
  o.country = a.country;
  o.governate = a.governate;
  o.regionCity = a.regionCity;
  o.street = a.street;
  o.buildingNumber = a.buildingNumber;
  putOptional(o, 'postalCode', a.postalCode);
  putOptional(o, 'floor', a.floor);
  putOptional(o, 'room', a.room);
  putOptional(o, 'landmark', a.landmark);
  putOptional(o, 'additionalInformation', a.additionalInformation);
  return o;
}

function lineObject(input: LineInput, c: CalcLine): DocObject {
  const o: DocObject = {};
  o.description = input.description;
  o.itemType = input.itemType;
  o.itemCode = input.itemCode;
  o.unitType = input.unitType;
  o.quantity = num(fmtDec(c.quantity));
  putOptional(o, 'internalCode', input.internalCode);
  o.salesTotal = num(fmtDec(c.salesTotal));
  o.total = num(fmtDec(c.total));
  o.valueDifference = num(fmtDec(c.valueDifference));
  o.totalTaxableFees = num(fmtDec(c.totalTaxableFees));
  o.netTotal = num(fmtDec(c.netTotal));
  o.itemsDiscount = num(fmtDec(c.itemsDiscount));
  const unitValue: DocObject = {
    currencySold: input.foreign ? input.foreign.currency : 'EGP',
    amountEGP: num(fmtDec(c.unitPriceEGP)),
  };
  if (input.foreign) {
    unitValue.amountSold = num(fmtDec(parseDec(input.foreign.amountSold)));
    unitValue.currencyExchangeRate = num(fmtDec(parseDec(input.foreign.exchangeRate)));
  }
  o.unitValue = unitValue;
  o.discount = { rate: num(fmtDec(c.discountRate)), amount: num(fmtDec(c.discountAmount)) };
  o.taxableItems = c.taxes.map((t) => ({
    taxType: t.taxType,
    amount: num(fmtDec(t.amount)),
    subType: t.subType,
    rate: num(fmtDec(t.rate)),
  }));
  return o;
}

export function buildDocument(input: EtaDocInput): BuiltDocument {
  const lines = input.lines.map((l) => calcLine(l, input.roundingPlaces ?? 2));
  const extra = input.extraDiscountAmount === undefined ? ZERO : parseDec(input.extraDiscountAmount);
  const totals = calcTotals(lines, extra);

  const doc: DocObject = {};
  doc.issuer = {
    address: addressObject(input.issuer.address, input.issuer.branchId),
    type: 'B',
    id: input.issuer.id,
    name: input.issuer.name,
  };
  const receiver: DocObject = {};
  if (input.receiver.address) receiver.address = addressObject(input.receiver.address);
  receiver.type = input.receiver.type;
  putOptional(receiver, 'id', input.receiver.id);
  putOptional(receiver, 'name', input.receiver.name);
  doc.receiver = receiver;
  doc.documentType = DOCUMENT_TYPE_CODE[input.kind];
  doc.documentTypeVersion = input.version;
  doc.dateTimeIssued = input.dateTimeIssued;
  doc.taxpayerActivityCode = input.taxpayerActivityCode;
  doc.internalID = input.internalId;
  putOptional(doc, 'purchaseOrderReference', input.purchaseOrderReference);
  putOptional(doc, 'purchaseOrderDescription', input.purchaseOrderDescription);
  putOptional(doc, 'salesOrderReference', input.salesOrderReference);
  putOptional(doc, 'salesOrderDescription', input.salesOrderDescription);
  putOptional(doc, 'proformaInvoiceNumber', input.proformaInvoiceNumber);
  if (input.kind !== 'invoice' && input.references && input.references.length > 0) {
    doc.references = [...input.references] as DocValue[];
  }
  doc.invoiceLines = input.lines.map((l, i) => lineObject(l, lines[i] as CalcLine));
  doc.totalDiscountAmount = num(fmtDec(totals.totalDiscountAmount));
  doc.totalSalesAmount = num(fmtDec(totals.totalSalesAmount));
  doc.netAmount = num(fmtDec(totals.netAmount));
  doc.taxTotals = totals.taxTotals.map((t) => ({ taxType: t.taxType, amount: num(fmtDec(t.amount)) }));
  doc.totalAmount = num(fmtDec(totals.totalAmount));
  doc.extraDiscountAmount = num(fmtDec(totals.extraDiscountAmount));
  doc.totalItemsDiscountAmount = num(fmtDec(totals.totalItemsDiscountAmount));
  return { doc, lines, totals };
}

/** Wrap signed documents in the submission body: { documents: [ ... ] }. */
export function submissionBody(docs: DocObject[]): DocObject {
  if (docs.length === 0) throw new Error('NO_DOCUMENTS');
  return { documents: docs };
}

/**
 * The exact text to POST. Always send this string as the body: re-serializing with JSON.stringify would turn 10.50 into 10.5 and
 * break the signature, because ETA hashes the text of every value as written.
 */
export function submissionBodyJson(docs: DocObject[]): string {
  return stringifyDoc(submissionBody(docs));
}
