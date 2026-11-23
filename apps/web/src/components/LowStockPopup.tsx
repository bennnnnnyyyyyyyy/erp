import { hasPermission } from '@erp/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { demoMode } from '../lib/demo';
import { tr, trf } from '../lib/i18n';
import { localName, unitLabel } from '../lib/names';
import { formatQty } from '../lib/numbers';
import { orderLink } from '../lib/orderLink';
import { navigate } from '../lib/router';
import { useSession } from '../session';
import { Modal } from './Modal';
import { Button } from './ui/button';

// The low stock pop-up (phase 1a; sql/106; documentation/plans/LOW_STOCK_POPUP_BUILD_PLAN.md, approved by Ben 23 Nov).
// - Only people who can reorder (stock request permission; the API and the database check again).
// - Once each sign-in (this browser tab), and again when the bell gets a new low stock alert (the bell sends 'erp:low-stock').
// - "Create purchase order" opens a filled draft; nothing is saved until the person places it. People who cannot make purchase orders
//   get "Ask for it" (a stock request). "Remind me" and "Don't show again" are the person's own settings.
// Before sql/106 is applied the list call answers 503 and the pop-up never shows.

export const LOW_STOCK_EVENT = 'erp:low-stock';

type Row = {
  itemId: string;
  sku: string;
  name: string;
  nameAr: string;
  uom: string;
  available: number;
  reorderLevel: number;
  suggestedQty: number;
  supplierId: string | null;
  supplierName: string | null;
};

export function LowStockPopup() {
  const session = useSession();
  const enabled =
    !demoMode && session.modules.includes('inventory') && hasPermission(session.permissions, 'inventory.request.create');
  const canOrder = session.modules.includes('purchasing') && hasPermission(session.permissions, 'purchasing.orders.create');
  const shownKey = `lowStockShown:${session.org?.id ?? ''}:${session.userId}`;
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force: boolean) => {
      try {
        const list = await api<Row[]>('/v1/inventory/low-stock/popup');
        setRows(list);
        if (list.length && (force || !sessionStorage.getItem(shownKey))) {
          sessionStorage.setItem(shownKey, '1');
          setOpen(true);
        }
      } catch {
        // 503 before sql/106, or no access: no pop-up.
      }
    },
    [shownKey],
  );

  useEffect(() => {
    if (!enabled) return;
    void load(false);
    const again = () => void load(true);
    window.addEventListener(LOW_STOCK_EVENT, again);
    return () => window.removeEventListener(LOW_STOCK_EVENT, again);
  }, [enabled, load]);

  if (!enabled || !open || !rows.length) return null;

  const drop = (itemId: string) => setRows((rs) => rs.filter((r) => r.itemId !== itemId));
  async function act(itemId: string, run: () => Promise<unknown>) {
    setBusy(itemId);
    setError(null);
    try {
      await run();
      drop(itemId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <Modal title={trf(rows.length === 1 ? '{n} item is low' : '{n} items are low', { n: rows.length })} onClose={() => setOpen(false)}>
      <div className="stack low-stock-popup">
        {rows.map((r) => (
          <div key={r.itemId} className="form-card stack" role="group" aria-label={localName(r)}>
            <div>
              <strong>{localName(r)}</strong> <code className="muted small">{r.sku}</code>
              <div className="muted small">
                {trf('Available {qty}, reorder level {level}', { qty: `${formatQty(r.available)} ${unitLabel(r.uom)}`, level: formatQty(r.reorderLevel) })}
                {r.suggestedQty > 0 ? ` · ${trf('suggested order {qty}', { qty: formatQty(r.suggestedQty) })}` : ''}
                {r.supplierName ? ` · ${r.supplierName}` : ''}
              </div>
            </div>
            <div className="form-actions">
              {canOrder ? (
                <Button disabled={busy === r.itemId} onClick={() => go(orderLink('/purchasing/orders/new', r.itemId, r.suggestedQty, r.supplierId))}>
                  {tr('Create purchase order')}
                </Button>
              ) : (
                <Button disabled={busy === r.itemId} onClick={() => go(orderLink('/inventory/requests/new', r.itemId, r.suggestedQty))}>
                  {tr('Ask for it')}
                </Button>
              )}
              <label className="inline-label small">
                <span className="sr-only">{tr('Remind me')}</span>
                <select
                  value=""
                  disabled={busy === r.itemId}
                  aria-label={trf('Remind me about {name}', { name: localName(r) })}
                  onChange={(e) => {
                    const span = e.target.value;
                    if (span) void act(r.itemId, () => api(`/v1/inventory/low-stock/${r.itemId}/snooze`, { method: 'POST', body: JSON.stringify({ for: span }) }));
                  }}
                >
                  <option value="">{tr('Remind me…')}</option>
                  <option value="hour">{tr('In 1 hour')}</option>
                  <option value="tomorrow">{tr('Next workday')}</option>
                  <option value="week">{tr('Next week')}</option>
                </select>
              </label>
              <Button variant="ghost" size="sm" disabled={busy === r.itemId} onClick={() => void act(r.itemId, () => api(`/v1/inventory/low-stock/${r.itemId}/mute`, { method: 'POST', body: '{}' }))}>
                {tr("Don't show again")}
              </Button>
            </div>
          </div>
        ))}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button variant="outline" onClick={() => go('/inventory/reorder-levels')}>{tr('Show all')}</Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>{tr('Close')}</Button>
        </div>
      </div>
    </Modal>
  );
}
