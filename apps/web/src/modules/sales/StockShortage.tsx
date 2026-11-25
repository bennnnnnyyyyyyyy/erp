import { hasPermission } from '@erp/shared';
import { api } from '../../lib/api';
import { orderLink } from '../../lib/orderLink';
import { formatQty } from '../../lib/numbers';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { tr, trf } from '../../lib/i18n';
import { useSession } from '../../session';
import { shortagesFor } from './shortage';

// Not enough stock to deliver a sales order (Ben, 25 Nov 2026: "when there isn't enough stock suggest the step that gets us stock").
// Shown on an order that has not asked the warehouse yet: for each item that is short in the order's warehouse, what is missing and
// the step that brings it, as far as the person may take it: a purchase order for the missing quantity (filled in, as the low stock
// pop-up does), or a transfer from a warehouse that has it.

type StockRow = { itemId: string; warehouseId: string; available: number };

export function StockShortage({ lines, warehouseId, itemName, warehouseName }: {
  lines: { itemId: string; qty: number }[];
  warehouseId: string;
  itemName: (id: string) => string;
  warehouseName: (id: string) => string;
}) {
  const session = useSession();
  const canSeeStock = hasPermission(session.permissions, 'inventory.items.read');
  const stock = useLoad(() => (canSeeStock ? api<StockRow[]>('/v1/inventory/stock') : Promise.resolve([] as StockRow[])));
  if (!canSeeStock || !stock.data) return null;
  const short = shortagesFor(lines, warehouseId, stock.data);
  if (short.length === 0) return null;
  const canOrder = session.modules.includes('purchasing') && hasPermission(session.permissions, 'purchasing.orders.create');
  const canMove = hasPermission(session.permissions, 'inventory.transfers.create');
  return (
    <div className="error notice" role="status">
      <p style={{ marginBlock: 0 }}>{trf('Not enough stock in {warehouse} to deliver this order:', { warehouse: warehouseName(warehouseId) })}</p>
      <ul style={{ marginBlock: '0.4rem 0' }}>
        {short.map((s) => (
          <li key={s.itemId}>
            {trf('{item}: needs {need}, available {available}, short {short}.', { item: itemName(s.itemId), need: formatQty(s.need), available: formatQty(s.available), short: formatQty(s.short) })}{' '}
            {canOrder && <Link to={orderLink('/purchasing/orders/new', s.itemId, s.short)}>{tr('Create purchase order')}</Link>}
            {canMove && s.elsewhere.length > 0 && (
              <>
                {canOrder ? ' · ' : ''}
                <Link to="/inventory/transfers/new">
                  {trf('Move from {warehouse} ({qty} available)', { warehouse: warehouseName(s.elsewhere[0]?.warehouseId ?? ''), qty: formatQty(s.elsewhere[0]?.available ?? 0) })}
                </Link>
              </>
            )}
            {!canOrder && !(canMove && s.elsewhere.length > 0) && <span className="muted"> {tr('Ask a manager to order it or move it from another warehouse.')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
