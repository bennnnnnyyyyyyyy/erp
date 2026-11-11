import { useState } from 'react';
import { formatMoney, hasPermission, type ProviderSettings } from '@erp/shared';
import { ConfirmButton } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import { formatDateTime } from '../../lib/format';
import { tr } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Notice, useNotice } from '../accounting/common';

// Bosta shipments on a sales order (sql/058). A courier update never changes stock or money: a returned parcel is shown here and a
// person starts a customer return through the normal approval. Cash on delivery is settled in finance.

type Shipment = {
  id: string;
  reference: string;
  tracking: string | null;
  status: 'pending' | 'created' | 'picked_up' | 'in_transit' | 'delivered' | 'returned' | 'exception' | 'cancelled' | 'lost' | 'failed';
  cod_minor: number;
  currency: string;
  recipient_name: string;
  city: string;
  simulated: boolean;
  note: string | null;
  updated_at: string;
};

const STATUS: Record<Shipment['status'], string> = {
  pending: 'Being created at Bosta',
  created: 'Created, waiting for pickup',
  picked_up: 'Picked up',
  in_transit: 'On its way',
  delivered: 'Delivered',
  returned: 'Returned to us',
  exception: 'Delivery problem',
  cancelled: 'Cancelled',
  lost: 'Lost',
  failed: 'Could not be created',
};

export function Shipments({ orderId, customerName, customerPhone, customerCity }: { orderId: string; customerName: string; customerPhone: string; customerCity: string }) {
  const session = useSession();
  const { message, busy, run } = useNotice();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: customerName, phone: customerPhone, city: customerCity, address: '', cod: '' });
  const allowed = !demoMode && hasPermission(session.permissions, 'sales.orders.read');
  const canMake = hasPermission(session.permissions, 'sales.orders.fulfill');
  const list = useLoad(() => (allowed ? api<Shipment[]>(`/v1/sales/shipments?orderId=${orderId}`) : Promise.resolve([] as Shipment[])));
  // Bosta must be switched on (needs the integrations view key); without it the section stays hidden unless shipments already exist.
  const providers = useLoad(() => (allowed && hasPermission(session.permissions, 'core.integrations.view') ? api<ProviderSettings[]>('/v1/core/integrations/providers') : Promise.resolve([] as ProviderSettings[])));
  if (!allowed) return null;
  if (!list.data || !providers.data) return <Loading error={list.error ?? providers.error} rows={2} />;
  const bostaOn = providers.data.some((p) => p.kind === 'bosta' && p.enabled);
  if (!bostaOn && !list.data.length) return null;

  return (
    <>
      <h2 className="related">{tr('Shipments')}</h2>
      <Notice message={message} />
      {list.data.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{tr('Tracking')}</th>
                <th scope="col">{tr('Recipient')}</th>
                <th scope="col" className="right">{tr('Cash on delivery')}</th>
                <th scope="col">{tr('Status')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <code>{s.tracking ?? s.reference}</code>
                    {s.simulated ? <span className="muted small"> · {tr('Simulated')}</span> : null}
                  </td>
                  <td>
                    {s.recipient_name} · {s.city}
                  </td>
                  <td className="right">{s.cod_minor ? formatMoney({ amountMinor: s.cod_minor, currency: s.currency }) : '—'}</td>
                  <td>
                    {tr(STATUS[s.status])}
                    {s.status === 'failed' && s.note ? <span className="error small"> · {s.note}</span> : null}
                    <span className="muted small"> · {formatDateTime(s.updated_at, session.org)}</span>
                    {s.status === 'returned' ? <span className="small"> · {tr('Start a customer return from Sales → Returns.')}</span> : null}
                  </td>
                  <td>
                    <div className="form-row">
                      {canMake && ['pending', 'created'].includes(s.status) ? (
                        <ConfirmButton
                          label={tr('Cancel shipment')}
                          confirmLabel={tr('Yes, cancel')}
                          question={tr('Cancel this shipment here? Also cancel it in Bosta if it was created there.')}
                          disabled={busy}
                          onConfirm={() => run(async () => { await api(`/v1/sales/shipments/${s.id}/cancel`, { method: 'POST' }); return tr('Cancelled.'); }, list.reload)}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {bostaOn && canMake ? (
        open ? (
          <form
            className="form-card stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api('/v1/sales/shipments', {
                  method: 'POST',
                  body: JSON.stringify({ orderId, recipientName: f.name, recipientPhone: f.phone, city: f.city, address: f.address, codMinor: f.cod ? Math.round(Number(f.cod) * 100) : 0 }),
                });
                setOpen(false);
                return tr('Shipment created.');
              }, list.reload);
            }}
          >
            <div className="form-row">
              <label>{tr('Recipient')}<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              <label>{tr('Phone')}<input required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
              <label>{tr('City')}<input required value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
            </div>
            <label>{tr('Address')}<input required value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
            <label>{tr('Cash on delivery (leave empty if already paid)')}<input type="number" min="0" step="0.01" value={f.cod} onChange={(e) => setF({ ...f, cod: e.target.value })} /></label>
            <div className="form-row">
              <Button type="submit" disabled={busy}>{tr('Create shipment')}</Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{tr('Close')}</Button>
            </div>
          </form>
        ) : (
          <div className="form-actions"><Button variant="outline" onClick={() => setOpen(true)}>{tr('New Bosta shipment')}</Button></div>
        )
      ) : null}
    </>
  );
}
