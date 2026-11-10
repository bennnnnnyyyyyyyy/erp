import { formatMoney, hasPermission } from '@erp/shared';
import { ClickRow } from '../../components/ClickRow';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { Link, navigate } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

type Open = { value: string; kind: string; id: string; number: string; partyId: string | null; currency: string; leftMinor: number; dueDate?: string; daysOverdue?: number };

/**
 * Supplier bills that are not fully paid, oldest due date first, each with a Pay button that opens the payment form already pointing at
 * the bill (walkthrough, 10 Nov 2026). Uses the same list the payment form uses (GET /v1/finance/open-items), so the numbers agree.
 * Shown to people who may read finance reports; for everyone else the section is simply absent.
 */
export function UnpaidBills({ supplierName }: { supplierName: (id: string) => string }) {
  const session = useSession();
  const allowed = hasPermission(session.permissions, 'finance.reports.view');
  const open = useLoad(() => (allowed ? api<Open[]>('/v1/finance/open-items?direction=out').catch(() => [] as Open[]) : Promise.resolve([] as Open[])));
  if (!allowed || !open.data) return null;
  const bills = open.data.filter((o) => o.kind === 'supplier_invoice').sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const canPay = hasPermission(session.permissions, 'finance.entries.manage');
  return (
    <>
      <h2 className="related">{tr('Unpaid bills')} <span className="muted small">({bills.length})</span></h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{tr('Supplier')}</th>
              <th scope="col">{tr('Invoice')}</th>
              <th scope="col">{tr('Due')}</th>
              <th scope="col" className="right">{tr('Left to pay')}</th>
              <th scope="col" className="right">{tr('Days overdue')}</th>
              {canPay ? <th scope="col">{tr('Actions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <ClickRow key={b.id} to={`/purchasing/invoices/${b.id}`}>
                <td>{b.partyId ? supplierName(b.partyId) : ''}</td>
                <td><Link to={`/purchasing/invoices/${b.id}`}><code>{b.number}</code></Link></td>
                <td className="nowrap">{formatDay(b.dueDate, session.org)}</td>
                <td className="right">{formatMoney({ amountMinor: b.leftMinor, currency: b.currency })}</td>
                <td className="right">{b.daysOverdue ? <span className="error">{b.daysOverdue}</span> : <span className="muted">0</span>}</td>
                {canPay ? (
                  <td>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/finance/payments?for=${b.value}`)} aria-label={trf('Pay bill {number}', { number: b.number })}>{tr('Pay')}</Button>
                  </td>
                ) : null}
              </ClickRow>
            ))}
            {!bills.length && <tr><td colSpan={canPay ? 6 : 5} className="muted empty">{tr('No unpaid bills.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
