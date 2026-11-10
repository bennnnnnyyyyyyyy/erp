import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import type { PurchaseOrder } from '../../lib/demoTrade';
import { formatDateTime } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { parseAmount } from '../../lib/numbers';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

// Purchase order approval (sql/069). The database decides who may approve (owners and admins, never the order's creator unless they
// are the only one) and refuses receiving while an order waits; these screens only show the state and send the decision.

/** On the order page: the waiting notice with Approve / Reject, or who decided and when. */
export function OrderApproval({ order, canDecide, mine, onDone }: {
  order: PurchaseOrder;
  canDecide: boolean;
  mine: boolean;
  onDone: (text: string) => void;
}) {
  const session = useSession();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/purchasing/orders/${order.id}/decide`, { method: 'POST', body: JSON.stringify({ decision, note: decision === 'rejected' ? reason.trim() : '' }) });
      setRejecting(false);
      onDone(decision === 'approved' ? tr('Order approved. The goods can now be received.') : tr('Order rejected and cancelled.'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (order.approval === 'approved' || order.approval === 'rejected') {
    return (
      <p className="muted small">
        {order.approval === 'approved' ? tr('Approved') : tr('Rejected')}
        {order.approvalDecidedAt ? ` · ${formatDateTime(order.approvalDecidedAt, session.org)}` : ''}
        {order.approvalSelf ? ` · ${tr('self-approved: no second approver in the company')}` : ''}
        {order.approvalNote ? <> · <bdi>{order.approvalNote}</bdi></> : null}
      </p>
    );
  }
  if (order.approval !== 'pending') return null;

  return (
    <div className="notice stack" role="status">
      <p>{tr('This order is waiting for approval by an owner or manager. Goods cannot be received until it is approved.')}</p>
      {mine && <p className="muted small">{tr('You created this order, so someone else must approve it, unless you are the only owner or manager.')}</p>}
      {canDecide && !rejecting && (
        <div className="form-actions">
          <Button disabled={busy} onClick={() => decide('approved')}>{tr('Approve order')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}>{tr('Reject…')}</Button>
        </div>
      )}
      {canDecide && rejecting && (
        <div className="form-row">
          <label>{tr('Reason')}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => decide('rejected')}>{tr('Reject and cancel')}</Button>
          <Button variant="ghost" onClick={() => setRejecting(false)}>{tr('Cancel')}</Button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** On the purchase orders list, for those who manage orders: whether orders need approval, and from what total. */
export function OrderApprovalSetting({ currency }: { currency: string }) {
  const saved = useLoad(() => api<{ on: boolean; fromMinor: number }>('/v1/purchasing/order-approval'));
  const [on, setOn] = useState<boolean | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (saved.error || !saved.data) return null; // not set up yet (sql/069 not applied) or no access

  const curOn = on ?? saved.data.on;
  const curFrom = from ?? String(saved.data.fromMinor / 100);
  const save = async () => {
    const minor = parseAmount(curFrom || '0');
    if (!Number.isFinite(minor) || minor < 0) {
      setMsg({ ok: false, text: tr('Enter an amount of zero or more.') });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api('/v1/purchasing/order-approval', { method: 'PUT', body: JSON.stringify({ on: curOn, fromMinor: Math.round(minor * 100) }) });
      saved.reload();
      setOn(null);
      setFrom(null);
      setMsg({ ok: true, text: tr('Saved.') });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-card stack" style={{ marginBlockStart: '1.5rem' }}>
      <h2 className="related">{tr('Approval of purchase orders')}</h2>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={curOn} onChange={(e) => setOn(e.target.checked)} />
        {tr('New orders need approval by an owner or manager before goods can be received')}
      </label>
      {curOn && (
        <label className="narrow">
          {trf('From an order total of ({currency})', { currency })}
          <input inputMode="decimal" value={curFrom} onChange={(e) => setFrom(e.target.value)} />
        </label>
      )}
      <p className="muted small">{tr('0 means every order. Orders already created keep their state.')}</p>
      <div className="form-actions"><Button size="sm" disabled={busy || (on === null && from === null)} onClick={save}>{tr('Save')}</Button></div>
      {msg && <p className={msg.ok ? 'success' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </div>
  );
}
