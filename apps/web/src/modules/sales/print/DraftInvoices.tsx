import { useState } from 'react';
import { ConfirmButton } from '../../../components/FormToggle';
import { Button, buttonVariants } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { formatDay } from '../../../lib/format';
import { tr } from '../../../lib/i18n';
import { Link } from '../../../lib/router';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';

// Draft invoices (sql/103): saved, not issued. A draft has no number and posts nothing; it can be edited, previewed with its DRAFT mark,
// discarded, or issued. Issuing runs every check again, gives the number (INV-2026-00001) and locks the invoice forever.

export type InvoiceDraft = {
  id: string;
  orderId: string;
  customerId: string;
  invoiceDate: string;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lines: { orderLineId: string; qty: number; taxRateId: string | null }[];
};

export function DraftInvoices({
  canManage,
  customer,
  orderNumber,
  onEdit,
  onIssued,
}: {
  canManage: boolean;
  customer: (id: string) => string;
  orderNumber: (orderId: string) => string;
  onEdit: (d: InvoiceDraft) => void;
  onIssued: (number: string) => void;
}) {
  const session = useSession();
  // Before migration 103 is applied the route answers 503: then there are simply no drafts to show.
  const drafts = useLoad(() => api<InvoiceDraft[]>('/v1/sales/invoice-drafts').catch(() => [] as InvoiceDraft[]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!drafts.data?.length) return null;

  async function act(d: InvoiceDraft, action: 'issue' | 'discard') {
    setBusy(true); setError(null);
    try {
      const r = await api<{ number?: string }>(`/v1/sales/invoice-drafts/${d.id}/${action}`, { method: 'POST' });
      drafts.reload();
      if (action === 'issue' && r.number) onIssued(r.number);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="related">{tr('Draft invoices')} <span className="muted small">({drafts.data.length})</span></h2>
      <p className="muted small">{tr('Drafts have no number yet and are not in your accounts. Issue a draft to give it its number; after that it can never change.')}</p>
      {error && <p className="error notice" role="alert">{error}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{tr('Order')}</th><th scope="col">{tr('Customer')}</th><th scope="col">{tr('Invoice date')}</th><th scope="col">{tr('Lines')}</th><th scope="col"><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
        <tbody>
          {drafts.data.map((d) => (
            <tr key={d.id}>
              <td><Link to={`/sales/orders/${d.orderId}`}><code>{orderNumber(d.orderId)}</code></Link></td>
              <td>{customer(d.customerId)}</td>
              <td className="nowrap">{formatDay(d.invoiceDate, session.org)}</td>
              <td>{d.lines.length}</td>
              <td>
                <div className="form-actions">
                  <Link to={`/sales/print/draft/${d.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{tr('Preview')}</Link>
                  {canManage ? (
                    <>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onEdit(d)}>{tr('Edit')}</Button>
                      <ConfirmButton label={tr('Issue')} confirmLabel={tr('Yes, issue it')} question={tr('Issue this invoice? It gets its number and is posted. It can never be changed afterwards: a mistake is corrected with a credit or debit note.')} disabled={busy} onConfirm={() => act(d, 'issue')} />
                      <ConfirmButton label={tr('Discard')} confirmLabel={tr('Yes, discard it')} question={tr('Discard this draft? Nothing was posted, so nothing else changes.')} disabled={busy} onConfirm={() => act(d, 'discard')} />
                    </>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
