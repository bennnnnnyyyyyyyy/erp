import { formatMoney } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { formatQty } from '../../lib/numbers';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

// Phase 0 of the Bellvox roadmap (UX audit 20 Nov): the home tiles "Receivables and payables" and "Top products" both opened the
// sales invoice list. They now open these two pages. Read only; the full tile detail views (chart first) come in phase 2b.

type OpenItem = {
  kind: 'customer_invoice' | 'supplier_invoice' | 'expense';
  id: string;
  number: string;
  partyId: string | null;
  currency: string;
  totalMinor: number;
  leftMinor: number;
  dueDate?: string;
  daysOverdue?: number;
  detail?: string;
};
type Party = { id: string; name: string };
type Item = { id: string; sku: string; name: string; uom: string };

const docLink = (i: OpenItem) =>
  i.kind === 'customer_invoice' ? `/sales/invoices/${i.id}` : i.kind === 'supplier_invoice' ? `/purchasing/invoices/${i.id}` : `/finance/expenses/${i.id}`;

function OwedTable({ title, items, parties, empty }: { title: string; items: OpenItem[]; parties: Party[]; empty: string }) {
  const session = useSession();
  const total = items.reduce((n, i) => n + i.leftMinor, 0);
  const late = items.filter((i) => (i.daysOverdue ?? 0) > 0).reduce((n, i) => n + i.leftMinor, 0);
  const currency = items[0]?.currency ?? session.org?.defaultCurrency ?? 'EGP';
  const sorted = [...items].sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
  const name = (id: string | null) => (id ? (parties.find((p) => p.id === id)?.name ?? '—') : '—');
  return (
    <section className="stack">
      <h2>{title}</h2>
      <p className="muted">
        {trf('Total {total} · of which overdue {late}', { total: formatMoney({ amountMinor: total, currency }), late: formatMoney({ amountMinor: late, currency }) })}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{tr('Document')}</th>
              <th scope="col">{tr('Customer or supplier')}</th>
              <th scope="col">{tr('Due date')}</th>
              <th scope="col" className="right">{tr('Days overdue')}</th>
              <th scope="col" className="right">{tr('Still owed')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={5} className="muted">{empty}</td></tr>
            ) : (
              sorted.map((i) => (
                <tr key={`${i.kind}:${i.id}`}>
                  <td><Link to={docLink(i)}><code>{i.number}</code></Link>{i.detail ? <span className="muted small"> · {i.detail}</span> : null}</td>
                  <td>{name(i.partyId)}</td>
                  <td>{i.dueDate ? formatDay(i.dueDate, session.org) : '—'}</td>
                  <td className="right">{(i.daysOverdue ?? 0) > 0 ? i.daysOverdue : '—'}</td>
                  <td className="right">{formatMoney({ amountMinor: i.leftMinor, currency: i.currency })}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Money owed to us (customer invoices) and money we owe (supplier invoices and expenses), most overdue first. */
export function MoneyOwedPage() {
  const owedIn = useLoad(() => api<OpenItem[]>('/v1/finance/open-items?direction=in'));
  const owedOut = useLoad(() => api<OpenItem[]>('/v1/finance/open-items?direction=out'));
  const customers = useLoad(() => api<Party[]>('/v1/sales/customers').catch(() => [] as Party[]));
  const suppliers = useLoad(() => api<Party[]>('/v1/purchasing/suppliers').catch(() => [] as Party[]));
  const error = owedIn.error ?? owedOut.error;
  if (error || !owedIn.data || !owedOut.data) return <section className="page"><Loading error={error} /></section>;
  return (
    <section className="page stack">
      <h1>{tr('Money owed')}</h1>
      <p className="muted">{tr('What customers still owe us, and what we still owe suppliers and for expenses. The most overdue come first.')}</p>
      <OwedTable title={tr('Customers owe us')} items={owedIn.data} parties={customers.data ?? []} empty={tr('Nothing is owed to us.')} />
      <OwedTable title={tr('We owe')} items={owedOut.data} parties={suppliers.data ?? []} empty={tr('We owe nothing.')} />
    </section>
  );
}

/** Every product sold in the last 90 days, ranked by sales before VAT, with quantity and share. */
export function ProductSalesPage() {
  const session = useSession();
  const sales = useLoad(() => api<{ days: number; totalMinor: number; rows: { itemId: string; qty: number; revenueMinor: number; sharePercent: number }[] }>('/v1/finance/product-sales?days=90'));
  const items = useLoad(() => api<Item[]>('/v1/inventory/items').catch(() => [] as Item[]));
  if (sales.error || !sales.data) return <section className="page"><Loading error={sales.error} /></section>;
  const currency = session.org?.defaultCurrency ?? 'EGP';
  const item = (id: string) => (items.data ?? []).find((i) => i.id === id);
  return (
    <section className="page stack">
      <h1>{tr('Sales by product')}</h1>
      <p className="muted">
        {trf('Last {days} days, issued invoices, before VAT. Total {total}.', { days: sales.data.days, total: formatMoney({ amountMinor: sales.data.totalMinor, currency }) })}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" className="right">#</th>
              <th scope="col">{tr('Item')}</th>
              <th scope="col" className="right">{tr('Quantity sold')}</th>
              <th scope="col" className="right">{tr('Sales before VAT')}</th>
              <th scope="col" className="right">{tr('Share')}</th>
            </tr>
          </thead>
          <tbody>
            {sales.data.rows.length === 0 ? (
              <tr><td colSpan={5} className="muted">{tr('No sales yet.')}</td></tr>
            ) : (
              sales.data.rows.map((r, n) => {
                const it = item(r.itemId);
                return (
                  <tr key={r.itemId}>
                    <td className="right">{n + 1}</td>
                    <td><Link to={`/inventory/items/${r.itemId}`}>{it ? `${it.sku} · ${it.name}` : r.itemId}</Link></td>
                    <td className="right">{formatQty(r.qty)} {it ? tr(it.uom) : ''}</td>
                    <td className="right">{formatMoney({ amountMinor: r.revenueMinor, currency })}</td>
                    <td className="right">{r.sharePercent}%</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
