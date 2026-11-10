import { formatQty } from '../../lib/numbers';
import { api } from '../../lib/api';
import type { DemoItem, DemoWarehouse, RequestStatus } from '../../lib/demoInventory';
import { useLoad } from '../../lib/useLoad';
import { tr } from '../../lib/i18n';

/** A quantity for display: thousands separated, at most three decimals, no trailing zeros (4,826 or 12.5). */
export const qty = (n: number) => formatQty(n);

const STATUS_LABEL: Record<RequestStatus, string> = {
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  issued: 'Issued',
  cancelled: 'Cancelled',
};

export function StatusPill({ status }: { status: RequestStatus }) {
  return <span className={`pill st-${status}`}>{tr(STATUS_LABEL[status])}</span>;
}

// Submitted, approved, issued: where this request is on the way out of the warehouse.
export function Steps({ status }: { status: RequestStatus }) {
  const order: RequestStatus[] = ['submitted', 'approved', 'issued'];
  const ended = status === 'rejected' || status === 'cancelled';
  const at = order.indexOf(status);
  const label = ['Submitted', ended ? (status === 'rejected' ? 'Rejected' : 'Cancelled') : 'Approved', 'Issued'];
  return (
    <ol className="steps" aria-label={tr('Request progress')}>
      {label.map((text, i) => {
        const cls = ended ? (i === 0 ? 'done' : i === 1 ? 'bad' : '') : i < at ? 'done' : i === at ? (status === 'issued' ? 'done' : 'current') : '';
        return (
          <li key={text} className={`step ${cls}`} data-n={i + 1}>
            {tr(text)}
          </li>
        );
      })}
    </ol>
  );
}

export function useCatalog() {
  const items = useLoad(() => api<DemoItem[]>('/v1/inventory/items'));
  const warehouses = useLoad(() => api<DemoWarehouse[]>('/v1/inventory/warehouses'));
  const itemName = (id: string) => items.data?.find((i) => i.id === id)?.name ?? id;
  const warehouseName = (id: string) => warehouses.data?.find((w) => w.id === id)?.name ?? id;
  return { items, warehouses, itemName, warehouseName, ready: Boolean(items.data && warehouses.data) };
}
