import { useState } from 'react';
import { hasPermission, formatMoney } from '@erp/shared';
import { Modal } from '../../components/Modal';
import { ErrorToast } from '../../components/Toast';
import { Button } from '../../components/ui/button';
import { ConfirmButton } from '../../components/FormToggle';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { formatQty, isBadAmount, parseAmount, toMinor } from '../../lib/numbers';
import { usePeople } from '../../lib/people';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';
import { canCancel, canDecide, creditableLeft, noteTotalMinor, type NoteForMath } from './noteMath';

// Credit and debit notes on one sales invoice (sql/037, sql/043; routes in apps/api/src/modules/sales/notes.ts). A note is a request:
// a different owner or admin approves it (a sole owner may approve their own, sql/063, 065). The database refuses what is not allowed
// and the message comes back in a popup.

export type NoteInvoice = {
  id: string;
  currency: string;
  status: 'issued' | 'void';
  lines: { id?: string; orderLineId: string; qty: number; unitPriceMinor: number }[];
};
type Note = NoteForMath & {
  id: string;
  number: string;
  invoiceId: string;
  currency: string;
  reason: string;
  totalMinor: number;
  requesterId: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
};
type Warehouse = { id: string; name: string };

const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency });
const STATUS_LABEL: Record<string, string> = { submitted: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
const PILL: Record<string, string> = { submitted: 'submitted', approved: 'approved', rejected: 'rejected', cancelled: 'cancelled' };

export function InvoiceNotes({ invoice, itemOf, onChanged }: { invoice: NoteInvoice; itemOf: (orderLineId: string) => string; onChanged: () => void }) {
  const session = useSession();
  const who = usePeople();
  const notes = useLoad(() => api<Note[]>(`/v1/sales/notes?invoiceId=${invoice.id}`));
  const [form, setForm] = useState<'credit' | 'debit' | null>(null);
  const [decide, setDecide] = useState<{ note: Note; decision: 'approve' | 'reject' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canRead = hasPermission(session.permissions, 'sales.notes.read');
  const canCreate = hasPermission(session.permissions, 'sales.notes.create');
  const canApprove = hasPermission(session.permissions, 'sales.notes.approve');
  if (!canRead) return null;

  const list = notes.data ?? [];
  const reload = () => { notes.reload(); onChanged(); };

  async function cancel(n: Note) {
    setBusy(true);
    try { await api(`/v1/sales/notes/${n.id}/cancel`, { method: 'POST' }); reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="section-head">
        <h2 className="related">{tr('Credit and debit notes')} <span className="muted small">({list.length})</span></h2>
        {canCreate && invoice.status === 'issued' && (
          <div className="form-actions">
            <Button variant="outline" size="sm" onClick={() => setForm('credit')}>{tr('Credit note')}</Button>
            <Button variant="outline" size="sm" onClick={() => setForm('debit')}>{tr('Debit note')}</Button>
          </div>
        )}
      </div>
      <p className="muted small">{tr('A credit note lowers what the customer owes (a return or a price correction); a debit note adds to it. Another owner or manager approves it before it counts.')}</p>
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{tr('No.')}</th><th scope="col">{tr('Kind')}</th><th scope="col">{tr('Status')}</th><th scope="col" className="right">{tr('Amount')}</th><th scope="col">{tr('Reason')}</th><th scope="col">{tr('Requested by')}</th><th scope="col">{tr('Decision')}</th><th scope="col">{tr('Actions')}</th></tr></thead>
        <tbody>
          {list.map((n) => (
            <tr key={n.id}>
              <td><code>{n.number}</code></td>
              <td>{n.kind === 'credit' ? tr('Credit note') : tr('Debit note')}</td>
              <td><Pill status={PILL[n.status] ?? n.status} label={tr(STATUS_LABEL[n.status] ?? n.status)} /></td>
              <td className="right">{money(n.totalMinor, n.currency)}</td>
              <td>{n.reason}</td>
              <td>{who(n.requesterId)}<div className="muted small">{formatDateTime(n.createdAt, session.org)}</div></td>
              <td>{n.decidedBy ? <>{who(n.decidedBy)}{n.decidedAt ? <div className="muted small">{formatDateTime(n.decidedAt, session.org)}</div> : null}{n.decisionComment ? <div className="muted small">“{n.decisionComment}”</div> : null}</> : <span className="muted">—</span>}</td>
              <td>
                <div className="form-actions">
                  {canDecide(n, canApprove) && (
                    <>
                      <Button size="sm" disabled={busy} onClick={() => setDecide({ note: n, decision: 'approve' })}>{tr('Approve')}</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setDecide({ note: n, decision: 'reject' })}>{tr('Reject')}</Button>
                    </>
                  )}
                  {canCancel(n, session.userId ?? '', canApprove) && (
                    <ConfirmButton label={tr('Cancel note')} confirmLabel={tr('Yes, cancel it')} question={tr('Cancel this note? It is no longer waiting for approval.')} disabled={busy} onConfirm={() => cancel(n)} />
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={8} className="muted empty">{notes.data ? tr('No credit or debit notes on this invoice.') : tr('Loading…')}</td></tr>}
        </tbody>
      </table></div>

      {form && <NoteForm kind={form} invoice={invoice} notes={list} itemOf={itemOf} onClose={() => setForm(null)} onError={setError} onDone={() => { setForm(null); reload(); }} />}
      {decide && <DecideForm note={decide.note} decision={decide.decision} onClose={() => setDecide(null)} onError={setError} onDone={() => { setDecide(null); reload(); }} />}
      <ErrorToast message={error} onClose={() => setError(null)} />
    </>
  );
}

function NoteForm({ kind, invoice, notes, itemOf, onClose, onError, onDone }: {
  kind: 'credit' | 'debit'; invoice: NoteInvoice; notes: Note[]; itemOf: (orderLineId: string) => string;
  onClose: () => void; onError: (m: string) => void; onDone: () => void;
}) {
  const session = useSession();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [price, setPrice] = useState<Record<string, string>>({});
  const [back, setBack] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [returnGoods, setReturnGoods] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [busy, setBusy] = useState(false);
  const canStock = kind === 'credit' && session.modules.includes('inventory');
  const warehouses = useLoad(() => (canStock ? api<Warehouse[]>('/v1/inventory/warehouses') : Promise.resolve([] as Warehouse[])));

  const lines = invoice.lines.filter((l): l is typeof l & { id: string } => Boolean(l.id));
  const maxFor = (l: (typeof lines)[number]) => (kind === 'credit' ? creditableLeft(l.qty, notes, l.id) : Number.POSITIVE_INFINITY);
  const qtyOf = (l: (typeof lines)[number]) => { const n = parseAmount(qty[l.id] ?? ''); return Number.isFinite(n) ? n : 0; };
  const priceOf = (l: (typeof lines)[number]) => (price[l.id] === undefined ? l.unitPriceMinor : toMinor(price[l.id] ?? ''));
  const backOf = (l: (typeof lines)[number]) => { const t = back[l.id]; const n = t === undefined ? qtyOf(l) : parseAmount(t); return Number.isFinite(n) ? n : 0; };

  const chosen = lines.filter((l) => qtyOf(l) > 0);
  const overQty = chosen.some((l) => qtyOf(l) > maxFor(l));
  const overPrice = kind === 'credit' && chosen.some((l) => priceOf(l) > l.unitPriceMinor);
  const badBack = returnGoods && chosen.some((l) => backOf(l) < 0 || backOf(l) > qtyOf(l));
  const returning = returnGoods ? chosen.filter((l) => backOf(l) > 0) : [];
  const needsWarehouse = returning.length > 0 && !warehouseId;
  const total = noteTotalMinor(chosen.map((l) => ({ qty: qtyOf(l), unitPriceMinor: priceOf(l) })));
  const ready = chosen.length > 0 && reason.trim() !== '' && !overQty && !overPrice && !badBack && !needsWarehouse;

  async function submit() {
    setBusy(true);
    try {
      const body = chosen.map((l) => ({ invoiceLineId: l.id, qty: qtyOf(l), ...(price[l.id] !== undefined ? { unitPriceMinor: priceOf(l) } : {}) }));
      if (returning.length > 0) {
        await api(`/v1/sales/invoices/${invoice.id}/returns`, { method: 'POST', body: JSON.stringify({ reason: reason.trim(), lines: chosen.map((l, i) => ({ ...body[i], returnQty: returnGoods ? backOf(l) : 0, warehouseId: backOf(l) > 0 ? warehouseId : undefined })) }) });
      } else {
        await api(`/v1/sales/invoices/${invoice.id}/notes`, { method: 'POST', body: JSON.stringify({ kind, reason: reason.trim(), lines: body }) });
      }
      onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal title={kind === 'credit' ? tr('New credit note') : tr('New debit note')} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{kind === 'credit' ? tr('Choose the quantity to credit on each line. You cannot credit more than was invoiced.') : tr('Choose the quantity and price to add on each line.')}</p>
        <div className="table-wrap"><table>
          <thead><tr>
            <th scope="col">{tr('Item')}</th>
            <th scope="col" className="right">{tr('Invoiced')}</th>
            {kind === 'credit' && <th scope="col" className="right">{tr('Can still be credited')}</th>}
            <th scope="col">{kind === 'credit' ? tr('Quantity to credit') : tr('Quantity to add')}</th>
            <th scope="col">{tr('Unit price')}</th>
            {returnGoods && <th scope="col">{tr('Back into stock')}</th>}
          </tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{itemOf(l.orderLineId)}</td>
                <td className="right">{formatQty(l.qty)}</td>
                {kind === 'credit' && <td className="right">{formatQty(maxFor(l))}</td>}
                <td><input inputMode="decimal" aria-label={trf('Quantity for {item}', { item: itemOf(l.orderLineId) })} value={qty[l.id] ?? ''} placeholder="0" disabled={maxFor(l) <= 0} aria-invalid={qtyOf(l) > maxFor(l) || isBadAmount(qty[l.id] ?? '')} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} /></td>
                <td><input inputMode="decimal" aria-label={trf('Unit price for {item}', { item: itemOf(l.orderLineId) })} value={price[l.id] ?? String(l.unitPriceMinor / 100)} onChange={(e) => setPrice((p) => ({ ...p, [l.id]: e.target.value }))} /></td>
                {returnGoods && <td><input inputMode="decimal" aria-label={trf('Quantity back into stock for {item}', { item: itemOf(l.orderLineId) })} value={back[l.id] ?? String(qtyOf(l) || '')} onChange={(e) => setBack((b) => ({ ...b, [l.id]: e.target.value }))} /></td>}
              </tr>
            ))}
          </tbody>
        </table></div>
        {overQty && <p className="error small">{tr('A quantity is above what can still be credited.')}</p>}
        {overPrice && <p className="error small">{tr('A credit note cannot credit more per unit than was invoiced.')}</p>}
        {badBack && <p className="error small">{tr('The quantity back into stock cannot be negative or more than the quantity credited.')}</p>}
        <label>{tr('Reason (required)')}<textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} /></label>
        {canStock && (
          <>
            <label><input type="checkbox" checked={returnGoods} onChange={(e) => setReturnGoods(e.target.checked)} /> {tr('The goods come back into stock')}</label>
            {returnGoods && (
              <label>{tr('Warehouse to return into')}
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">{tr('Choose a warehouse…')}</option>
                  {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
            )}
            {returnGoods && <p className="muted small">{tr('The stock is added back only when the note is approved, at the cost it left at.')}</p>}
          </>
        )}
        <p><strong>{tr('Note total')}: {money(total, invoice.currency)}</strong></p>
        <div className="form-actions">
          <Button disabled={busy || !ready} onClick={submit}>{busy ? tr('Submitting…') : tr('Submit for approval')}</Button>
          <Button variant="ghost" onClick={onClose}>{tr('Close')}</Button>
        </div>
      </div>
    </Modal>
  );
}

function DecideForm({ note, decision, onClose, onError, onDone }: { note: Note; decision: 'approve' | 'reject'; onClose: () => void; onError: (m: string) => void; onDone: () => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const approving = decision === 'approve';
  async function send() {
    setBusy(true);
    try { await api(`/v1/sales/notes/${note.id}/${decision}`, { method: 'POST', body: JSON.stringify({ comment: comment.trim() }) }); onDone(); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title={trf(approving ? 'Approve {number}' : 'Reject {number}', { number: note.number })} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{note.reason}</p>
        <label>{approving ? tr('Comment (optional)') : tr('Reason for rejecting (required)')}<textarea value={comment} rows={2} maxLength={500} onChange={(e) => setComment(e.target.value)} /></label>
        <div className="form-actions">
          <Button variant={approving ? 'default' : 'outline'} disabled={busy || (!approving && comment.trim() === '')} onClick={send}>{approving ? tr('Approve') : tr('Reject')}</Button>
          <Button variant="ghost" onClick={onClose}>{tr('Close')}</Button>
        </div>
      </div>
    </Modal>
  );
}
