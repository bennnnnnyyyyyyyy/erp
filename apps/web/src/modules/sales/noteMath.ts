// Pure helpers for the credit and debit note form on the sales invoice page. The database is the judge (sql/037); these only let the
// screen offer sensible quantities and show the amount still owed.
import { vatLine, vatLineInclusive, vatTotals, type VatLine } from '@erp/shared';

export type NoteForMath = { kind: string; status: string; lines: { invoiceLineId: string; qty: number }[] };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Quantity of one invoice line already credited by approved notes or waiting for approval (rejected and cancelled notes free it again). */
export function creditedQty(notes: NoteForMath[], invoiceLineId: string): number {
  let sum = 0;
  for (const n of notes) {
    if (n.kind !== 'credit' || (n.status !== 'submitted' && n.status !== 'approved')) continue;
    for (const l of n.lines) if (l.invoiceLineId === invoiceLineId) sum += l.qty;
  }
  return round3(sum);
}

/** How much of an invoice line can still be credited: invoiced minus already credited or waiting, never below zero. */
export function creditableLeft(invoicedQty: number, notes: NoteForMath[], invoiceLineId: string): number {
  return Math.max(0, round3(invoicedQty - creditedQty(notes, invoiceLineId)));
}

/** Money of a note from its lines, in minor units, rounded per the database (quantity times unit price). */
export function noteTotalMinor(lines: { qty: number; unitPriceMinor: number }[]): number {
  return lines.reduce((n, l) => n + Math.round(l.qty * l.unitPriceMinor), 0);
}

/** A note's net, VAT and gross from its lines: each line keeps its invoice line's VAT rate (sql/086); the database computes the same. */
export function noteVatTotals(lines: { qty: number; unitPriceMinor: number; taxRate?: number; priceIncludesVat?: boolean }[]): VatLine {
  // a line typed with VAT (sql/093) is split the same way on the note
  return vatTotals(lines.map((l) => (l.priceIncludesVat ? vatLineInclusive : vatLine)(l.qty, l.unitPriceMinor, l.taxRate ?? 0)));
}

/** What the customer owes on the invoice: its total less approved credit notes plus approved debit notes. */
export function netInvoiceMinor(totalMinor: number, creditedMinor: number, debitedMinor: number): number {
  return totalMinor - creditedMinor + debitedMinor;
}

/** Whether a waiting note should show Approve / Reject: the person holds the approve permission and the note is still waiting.
 *  A note the person requested themselves shows them only when the database would allow it (UX audit 23 Nov: they were shown and
 *  then refused): `own.userId` is the person, `own.mayDecideOwn` whether they may decide their own requests (see mayDecideOwn). */
export function canDecide(
  note: { status: string; requesterId?: string },
  hasApprove: boolean,
  own?: { userId: string; mayDecideOwn: boolean },
): boolean {
  if (!hasApprove || note.status !== 'submitted') return false;
  if (own && note.requesterId === own.userId && !own.mayDecideOwn) return false;
  return true;
}

/**
 * Whether this person may decide their own note, as the database allows: they are the company's only active owner or admin (decisions
 * D1 and D1b, sql/063 and sql/065), or they are an owner and the company switched on "owners may approve their own" (D1c, sql/077).
 * Admins and members never decide their own otherwise.
 */
export function mayDecideOwn(
  me: { userId: string; role: string | null },
  members: { userId: string; role: string; status: string }[],
  ownerSelfApproval: boolean,
): boolean {
  if (me.role !== 'owner' && me.role !== 'admin') return false;
  if (me.role === 'owner' && ownerSelfApproval) return true;
  return !members.some((m) => m.userId !== me.userId && m.status === 'active' && (m.role === 'owner' || m.role === 'admin'));
}

/** Whether Cancel is offered: only while waiting, to the requester (owners and admins may also cancel, as the database allows). */
export function canCancel(note: { status: string; requesterId: string }, userId: string, hasApprove: boolean): boolean {
  return note.status === 'submitted' && (note.requesterId === userId || hasApprove);
}
