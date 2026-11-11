import { describe, expect, it } from 'vitest';
import { canCancel, canDecide, creditableLeft, creditedQty, netInvoiceMinor, noteTotalMinor, type NoteForMath } from './noteMath';

const note = (kind: string, status: string, qty: number, id = 'L1'): NoteForMath => ({ kind, status, lines: [{ invoiceLineId: id, qty }] });

describe('credit note quantities', () => {
  it('counts approved and waiting credit notes, not rejected, cancelled or debit ones', () => {
    const notes = [note('credit', 'approved', 2), note('credit', 'submitted', 1.5), note('credit', 'rejected', 4), note('credit', 'cancelled', 4), note('debit', 'approved', 9), note('credit', 'approved', 3, 'L2')];
    expect(creditedQty(notes, 'L1')).toBe(3.5);
    expect(creditableLeft(10, notes, 'L1')).toBe(6.5);
  });
  it('never goes below zero and avoids float noise', () => {
    expect(creditableLeft(1, [note('credit', 'approved', 2)], 'L1')).toBe(0);
    expect(creditableLeft(0.3, [note('credit', 'approved', 0.1), note('credit', 'approved', 0.2)], 'L1')).toBe(0);
  });
});

describe('note money', () => {
  it('totals lines and nets the invoice', () => {
    expect(noteTotalMinor([{ qty: 2.5, unitPriceMinor: 1001 }, { qty: 1, unitPriceMinor: 500 }])).toBe(3003);
    expect(netInvoiceMinor(10000, 2500, 400)).toBe(7900);
  });
});

describe('who sees which button', () => {
  it('offers approve only while waiting and with the permission', () => {
    expect(canDecide({ status: 'submitted' }, true)).toBe(true);
    expect(canDecide({ status: 'submitted' }, false)).toBe(false);
    expect(canDecide({ status: 'approved' }, true)).toBe(false);
  });
  it('offers cancel to the requester or a decider, only while waiting', () => {
    expect(canCancel({ status: 'submitted', requesterId: 'u1' }, 'u1', false)).toBe(true);
    expect(canCancel({ status: 'submitted', requesterId: 'u1' }, 'u2', false)).toBe(false);
    expect(canCancel({ status: 'submitted', requesterId: 'u1' }, 'u2', true)).toBe(true);
    expect(canCancel({ status: 'rejected', requesterId: 'u1' }, 'u1', true)).toBe(false);
  });
});
