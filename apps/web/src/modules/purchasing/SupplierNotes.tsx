import { useState } from 'react';
import { mayDecide, OWN_REQUEST_TEXT } from '../../lib/approvals';
import { formatMoney, hasPermission } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { tr, trf } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill, toMinor } from '../trade/common';

// Supplier credit and debit notes on a bill (sql/094, VAT plan section 16). The database is the judge: never more than billed, VAT as
// printed within the bills' tolerance, someone other than the requester decides (unless the only manager). Nothing counts until approved.

type BillLine = { id?: string; orderLineId: string; qty: number; unitCostMinor: number; taxRate?: number };
type Note = {
  id: string;
  number: string;
  kind: 'credit' | 'debit';
  status: 'submitted' | 'approved' | 'rejected' | 'cancelled';
  currency: string;
  reason: string;
  supplierRef: string | null;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  requesterId: string;
  selfDecided: boolean;
};

export function SupplierNotes({ billId, currency, lines, itemOf, onChanged }: { billId: string; currency: string; lines: (BillLine & { billLineId?: string })[]; itemOf: (orderLineId: string) => string; onChanged: () => void }) {
  const session = useSession();
  const canRead = hasPermission(session.permissions, 'purchasing.notes.read');
  const canCreate = hasPermission(session.permissions, 'purchasing.notes.create');
  const canApprove = hasPermission(session.permissions, 'purchasing.notes.approve');
  const notes = useLoad(() => (canRead ? api<Note[]>(`/v1/purchasing/supplier-invoices/${billId}/notes`).catch(() => [] as Note[]) : Promise.resolve([] as Note[])));
  const [kind, setKind] = useState<'credit' | 'debit' | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [eta, setEta] = useState('');
  const [vat, setVat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const money = (v: number) => formatMoney({ amountMinor: v, currency });
  if (!canRead) return null;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await fn() });
      notes.reload();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const withIds = lines.filter((l): l is typeof l & { billLineId: string } => Boolean(l.billLineId));
  const chosen = withIds.filter((l) => Number(qty[l.billLineId]) > 0);

  return (
    <div className="stack">
      <h2 className="related">{tr('Supplier credit and debit notes')} <span className="muted small">({notes.data?.length ?? 0})</span></h2>
      <p className="muted small">{tr('A supplier credit note lowers what you owe the supplier (a return or a price correction); a debit note adds to it. Another owner or manager approves it before it counts.')}</p>
      {message ? <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{tr('No.')}</th>
              <th scope="col">{tr('Kind')}</th>
              <th scope="col">{tr('Status')}</th>
              <th scope="col">{tr('Supplier\'s note number')}</th>
              <th scope="col" className="right">{tr('Before VAT')}</th>
              <th scope="col" className="right">{tr('VAT')}</th>
              <th scope="col" className="right">{tr('Amount')}</th>
              <th scope="col">{tr('Reason')}</th>
              <th scope="col">{tr('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {(notes.data ?? []).map((n) => (
              <tr key={n.id}>
                <td><code>{n.number}</code></td>
                <td>{n.kind === 'credit' ? tr('Credit') : tr('Debit')}</td>
                <td>
                  <Pill status={n.status === 'approved' ? 'received' : n.status === 'submitted' ? 'submitted' : 'cancelled'} label={tr(n.status === 'submitted' ? 'Waiting' : n.status === 'approved' ? 'Approved' : n.status === 'rejected' ? 'Rejected' : 'Cancelled')} />
                  {n.selfDecided ? <span className="muted small"> {tr('self-approved')}</span> : null}
                </td>
                <td>{n.supplierRef ?? '—'}</td>
                <td className="right">{money(n.netMinor)}</td>
                <td className="right">{money(n.taxMinor)}</td>
                <td className="right">{money(n.grossMinor)}</td>
                <td>{n.reason}</td>
                <td className="nowrap">
                  {n.status === 'submitted' && canApprove && !mayDecide(session, n.requesterId) ? <span className="muted small">{tr(OWN_REQUEST_TEXT)}</span> : null}
                  {n.status === 'submitted' && canApprove && mayDecide(session, n.requesterId) ? (
                    <>
                      <Button size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/purchasing/notes/${n.id}/approve`, { method: 'POST', body: '{}' }); return trf('{number} approved.', { number: n.number }); })}>{tr('Approve')}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => { await api(`/v1/purchasing/notes/${n.id}/reject`, { method: 'POST', body: '{}' }); return trf('{number} rejected.', { number: n.number }); })}>{tr('Reject')}</Button>
                    </>
                  ) : null}
                  {n.status === 'submitted' && (n.requesterId === session.userId || canApprove) ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => { await api(`/v1/purchasing/notes/${n.id}/cancel`, { method: 'POST', body: '{}' }); return trf('{number} cancelled.', { number: n.number }); })}>{tr('Cancel')}</Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!notes.data?.length ? <tr><td colSpan={9} className="muted empty">{tr('No supplier notes on this bill.')}</td></tr> : null}
          </tbody>
        </table>
      </div>

      {canCreate && !kind ? (
        <div className="form-row">
          <Button variant="outline" onClick={() => setKind('credit')}>{tr('Supplier credit note')}</Button>
          <Button variant="outline" onClick={() => setKind('debit')}>{tr('Supplier debit note')}</Button>
        </div>
      ) : null}
      {kind ? (
        <div className="form-card stack">
          <h3>{kind === 'credit' ? tr('New supplier credit note') : tr('New supplier debit note')}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{tr('Item')}</th>
                  <th scope="col" className="right">{tr('Billed')}</th>
                  <th scope="col">{kind === 'credit' ? tr('Quantity to credit') : tr('Quantity to add')}</th>
                  <th scope="col">{tr('Unit cost (before VAT)')}</th>
                </tr>
              </thead>
              <tbody>
                {withIds.map((l) => (
                  <tr key={l.billLineId}>
                    <td>{itemOf(l.orderLineId)}</td>
                    <td className="right">{l.qty}</td>
                    <td><input inputMode="decimal" placeholder="0" aria-label={trf('Quantity for {item}', { item: itemOf(l.orderLineId) })} value={qty[l.billLineId] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.billLineId]: e.target.value }))} /></td>
                    <td><input inputMode="decimal" aria-label={trf('Unit cost for {item}', { item: itemOf(l.orderLineId) })} value={cost[l.billLineId] ?? String(l.unitCostMinor / 100)} onChange={(e) => setCost((p) => ({ ...p, [l.billLineId]: e.target.value }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-row">
            <label>{tr('Supplier\'s note number')}<input value={supplierRef} maxLength={100} onChange={(e) => setSupplierRef(e.target.value)} /></label>
            <label>{tr('Supplier\'s e-invoice number')}<input value={eta} maxLength={100} onChange={(e) => setEta(e.target.value)} /></label>
            <label>{tr('VAT on the supplier\'s note')}<input inputMode="decimal" value={vat} placeholder={tr('Worked out from the lines')} onChange={(e) => setVat(e.target.value)} /></label>
          </div>
          <label>{tr('Reason (required)')}<textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="form-actions">
            <Button
              disabled={busy || !chosen.length || !reason.trim()}
              onClick={() =>
                run(async () => {
                  const body = {
                    kind,
                    reason: reason.trim(),
                    supplierRef: supplierRef.trim() || undefined,
                    lines: chosen.map((l) => ({ billLineId: l.billLineId, qty: Number(qty[l.billLineId]), ...(cost[l.billLineId] !== undefined ? { unitCostMinor: toMinor(cost[l.billLineId] ?? '') } : {}) })),
                    vat: { ...(vat.trim() ? { taxMinor: toMinor(vat) } : {}), ...(eta.trim() ? { documentRef: eta.trim() } : {}) },
                  };
                  const made = await api<{ number: string }>(`/v1/purchasing/supplier-invoices/${billId}/notes`, { method: 'POST', body: JSON.stringify(body) });
                  setKind(null); setQty({}); setCost({}); setReason(''); setSupplierRef(''); setEta(''); setVat('');
                  return trf('{number} submitted for approval.', { number: made.number });
                })
              }
            >
              {busy ? tr('Submitting…') : tr('Submit for approval')}
            </Button>
            <Button variant="ghost" onClick={() => setKind(null)}>{tr('Close')}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
