import { Loading } from '../../components/Loading';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import type { LedgerMove } from '../../lib/demoInventory';
import { usePeople } from '../../lib/people';
import { formatDateTime } from '../../lib/format';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { tr } from '../../lib/i18n';
import { qty, useCatalog } from './inventoryShared';

// ------------------------------------------------------------------ ledger

/** Plain words for the stock ledger's movement codes (UX audit: the list showed `transfer_out`, `return_in`). */
export const MOVE_KIND_LABEL: Record<string, string> = {
  receipt: 'Received', issue: 'Issued', adjust: 'Count adjustment', transfer_out: 'Transfer out', transfer_in: 'Transfer in', return_in: 'Customer return',
};

export function LedgerPage() {
  const who = usePeople();
  const cat = useCatalog();
  const moves = useLoad(() => api<LedgerMove[]>('/v1/inventory/ledger'));
  const session = useSession();

  const columns: Column<LedgerMove>[] = [
    { key: 'when', label: tr('When'), value: (m) => m.postedAt, render: (m) => <span className="nowrap">{formatDateTime(m.postedAt, session.org)}</span> },
    { key: 'item', label: tr('Item'), value: (m) => cat.itemName(m.itemId), render: (m) => <Link to={`/inventory/items/${m.itemId}`}>{cat.itemName(m.itemId)}</Link> },
    { key: 'wh', label: tr('Warehouse'), value: (m) => cat.warehouseName(m.warehouseId) },
    { key: 'kind', label: tr('Type'), value: (m) => m.kind, render: (m) => tr(MOVE_KIND_LABEL[m.kind] ?? m.kind) },
    { key: 'qty', label: tr('Quantity'), value: (m) => m.qty, align: 'right', render: (m) => <strong className={m.qty < 0 ? 'overdue' : undefined}>{m.qty > 0 ? `+${m.qty}` : m.qty}</strong> },
    // UX audit: transfers, adjustments and returns all said "opening stock" here, and the order link was built from a sample-data id.
    { key: 'req', label: tr('Reference'), value: (m) => m.requestNumber ?? m.ref ?? '', render: (m) => (m.requestId ? <Link to={`/inventory/requests/${m.requestId}`}>{m.requestNumber ?? (/^r\d+$/.test(m.requestId) ? `OUT-${m.requestId.slice(1).padStart(4, '0')}` : tr('Request'))}</Link> : m.ref ? <code>{m.ref}</code> : <span className="muted">—</span>) },
    { key: 'by', label: tr('Posted by'), value: (m) => who(m.postedBy) },
  ];

  return (
    <section className="page">
      <h1>{tr('Stock ledger')}</h1>
      <p className="muted">{tr('Every stock movement, newest first. Entries are never edited.')}</p>
      {moves.data && cat.ready ? <ListView title={tr('Stock ledger')} rows={moves.data} columns={columns} rowKey={(m) => String(m.id)} /> : <Loading />}
    </section>
  );
}

