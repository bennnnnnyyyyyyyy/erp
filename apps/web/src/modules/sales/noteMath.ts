// Pure helpers for the credit and debit note form on the sales invoice page. The database is the judge (sql/037); these only let the
// screen offer sensible quantities and show the amount still owed.

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

/** What the customer owes on the invoice: its total less approved credit notes plus approved debit notes. */
export function netInvoiceMinor(totalMinor: number, creditedMinor: number, debitedMinor: number): number {
  return totalMinor - creditedMinor + debitedMinor;
}

/** Whether a waiting note should show Approve / Reject: the person holds the approve permission and the note is still waiting.
 *  A note you requested yourself still shows them: the database refuses it unless you are the only owner or admin (sql/063, 065). */
export function canDecide(note: { status: string }, hasApprove: boolean): boolean {
  return hasApprove && note.status === 'submitted';
}

/** Whether Cancel is offered: only while waiting, to the requester (owners and admins may also cancel, as the database allows). */
export function canCancel(note: { status: string; requesterId: string }, userId: string, hasApprove: boolean): boolean {
  return note.status === 'submitted' && (note.requesterId === userId || hasApprove);
}
