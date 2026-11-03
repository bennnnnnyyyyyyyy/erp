// Pre-flight checks that mirror what ETA will check, so a document fails here in plain words instead of coming back
// "invalid" after submission. Rules come from the Invoice/Credit/Debit v1.0 pages and the validation rules page.
// Anything the SDK does not publish (for example the person-buyer threshold) is deliberately NOT checked here.

import { isValidTaxPair, ITEM_TYPES } from './codes';
import { type EtaDocInput } from './build';
import { calcLine, calcTotals } from './calc';
import { parseDec, ZERO } from './decimal';

/** `error` blocks sending; `warning` is shown but does not block (used where the SDK does not say the rule is enforced). */
export type Issue = { code: string; message: string; path: string; severity: 'error' | 'warning' };

const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function validateInput(input: EtaDocInput, now: Date = new Date()): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message, severity: 'error' });

  if (!UTC_RE.test(input.dateTimeIssued)) {
    add('DATE_FORMAT', 'dateTimeIssued', 'Use a UTC time like 2026-11-02T10:15:00Z.');
  } else if (new Date(input.dateTimeIssued).getTime() > now.getTime()) {
    add('DATE_IN_FUTURE', 'dateTimeIssued', 'The issue time cannot be in the future.');
  }
  if (!input.taxpayerActivityCode) add('ACTIVITY_CODE', 'taxpayerActivityCode', 'The company activity code is missing.');
  if (!input.internalId) add('INTERNAL_ID', 'internalId', 'The document number is missing.');

  const iss = input.issuer;
  if (!iss.id) add('ISSUER_ID', 'issuer.id', 'The company registration number is missing.');
  if (!iss.branchId) add('BRANCH_ID', 'issuer.address.branchId', 'The branch code is required for a business issuer.');
  if (iss.address.country !== 'EG') add('ISSUER_COUNTRY', 'issuer.address.country', 'The issuer country must be EG.');

  const rec = input.receiver;
  if (rec.type === 'B' || rec.type === 'F') {
    if (!rec.id) add('RECEIVER_ID', 'receiver.id', 'The customer tax registration number is missing.');
    if (!rec.name) add('RECEIVER_NAME', 'receiver.name', 'The customer name is missing.');
    if (!rec.address) add('RECEIVER_ADDRESS', 'receiver.address', 'The customer address is missing.');
  }
  if (rec.id && rec.id === iss.id) add('SAME_PARTY', 'receiver.id', 'The customer and the issuer cannot be the same.');

  if (input.lines.length === 0) add('NO_LINES', 'lines', 'At least one line is required.');
  input.lines.forEach((l, i) => {
    const p = `lines[${i}]`;
    if (!(ITEM_TYPES as readonly string[]).includes(l.itemType)) add('ITEM_TYPE', `${p}.itemType`, 'Item type must be GS1 or EGS.');
    if (!l.itemCode) add('ITEM_CODE', `${p}.itemCode`, `"${l.description}" has no ETA item code.`);
    if (!l.unitType) add('UNIT_TYPE', `${p}.unitType`, `"${l.description}" has no ETA unit code.`);
    if (l.foreign && (!l.foreign.amountSold || !l.foreign.exchangeRate)) {
      add('FOREIGN_FIELDS', `${p}.unitValue`, 'A foreign-currency line needs the amount sold and the exchange rate.');
    }
    if (l.foreign && l.foreign.currency === 'EGP') add('FOREIGN_EGP', `${p}.unitValue`, 'Amount sold must not be set for EGP.');
    for (const t of l.taxes) {
      if (!isValidTaxPair(t.taxType, t.subType)) {
        add('TAX_SUBTYPE', `${p}.taxableItems`, `Tax ${t.taxType} cannot use subtype "${t.subType}".`);
      }
      if (t.rate !== undefined) {
        const r = parseDec(t.rate);
        if (r < 0n || r > 999n * 100000n) add('TAX_RATE', `${p}.taxableItems`, 'A tax rate must be between 0 and 999.');
      }
    }
  });

  const refs = input.references ?? [];
  if (input.kind === 'invoice' && refs.length > 0) add('REFERENCES_ON_INVOICE', 'references', 'An invoice cannot reference other documents.');
  if (input.kind !== 'invoice' && refs.length === 0) {
    add('REFERENCES_MISSING', 'references', 'A credit or debit note must reference the original invoice.');
  }
  return issues;
}

export type OriginalInvoice = {
  etaUuid: string;
  receiverId: string | undefined;
  dateTimeIssued: string;
  lines: { itemCode: string; quantity: string; unitPriceEGP: string }[];
  /** totalAmount of the original, as stated in the document ETA holds. */
  totalAmount: string;
};

/**
 * Credit / debit note rules against the invoices it references (official: Credit Note v1.0 page and Reference Document Validator):
 * same issuer's invoices to the same recipient, dated before the note, the same items (only quantities and amounts may change),
 * and a credit note's total must not exceed the originals' total.
 */
export function validateNote(input: EtaDocInput, originals: OriginalInvoice[], now?: Date): Issue[] {
  const issues: Issue[] = validateInput(input, now);
  const add = (code: string, path: string, message: string, severity: Issue['severity'] = 'error') => issues.push({ code, path, message, severity });
  if (input.kind === 'invoice') return issues;

  const refs = new Set(input.references ?? []);
  for (const o of originals) refs.delete(o.etaUuid);
  if (refs.size > 0) add('REFERENCE_UNKNOWN', 'references', `Referenced invoice not found: ${[...refs].join(', ')}.`);

  for (const o of originals) {
    if (o.receiverId !== input.receiver.id) add('REFERENCE_RECIPIENT', 'references', 'The note and the invoice must have the same customer.');
    if (!(o.dateTimeIssued < input.dateTimeIssued)) add('REFERENCE_DATE', 'dateTimeIssued', 'The note must be dated after the invoice.');
  }
  const originalCodes = new Set(originals.flatMap((o) => o.lines.map((l) => l.itemCode)));
  const noteCodes = new Set(input.lines.map((l) => l.itemCode));
  for (const c of noteCodes) if (!originalCodes.has(c)) add('NOTE_NEW_ITEM', 'lines', `Item ${c} is not on the original invoice(s).`);
  // The SDK says a note's lines must equal the referenced invoices' lines with only quantities and amounts changed, but also that a
  // line's quantity must be above zero. Whether a partial note may leave an item out is therefore Unverified (plan section 13): warn, do not block.
  for (const c of originalCodes) {
    if (!noteCodes.has(c)) add('NOTE_MISSING_ITEM', 'lines', `Item ${c} from the original invoice(s) is not on the note. ETA may require every original line; check on PreProd.`, 'warning');
  }

  if (input.kind === 'credit') {
    const noteTotal = calcTotals(input.lines.map((l) => calcLine(l)), input.extraDiscountAmount ? parseDec(input.extraDiscountAmount) : ZERO).totalAmount;
    const originalTotal = originals.reduce((s, o) => s + parseDec(o.totalAmount), ZERO);
    if (noteTotal > originalTotal) add('CREDIT_EXCEEDS_ORIGINAL', 'totalAmount', 'A credit note cannot exceed the original invoice total.');
  }
  return issues;
}
