import { useState } from 'react';
import { type Account, type AccountRole, type SwitchOnPreview, type UncostedReceipt } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { usePeople } from '../../lib/people';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { toMinor } from '../trade/common';
import { AccountSelect, Notice, accountLabel, money, useChartManager, useNotice } from './common';

// The part of Accounting setup that an accountant, not the owner, cares about: which account each kind of document posts to, expense
// categories, costs for old receipts, and the head accountant. It sits under "Advanced (for your accountant)" in the guide (SetupGuide.tsx);
// the default chart fills almost all of it, so most companies never change anything here.

const ROLE_LABEL: Record<AccountRole, string> = {
  inventory: 'Inventory',
  receivables: 'Customers (receivables)',
  cash: 'Cash',
  bank: 'Bank',
  card_clearing: 'Card payments in clearing',
  cheque_in_clearing: 'Cheques received, not yet cleared',
  cheque_out_clearing: 'Cheques issued, not yet cleared',
  other_clearing: 'Other payment methods in clearing',
  opening_balance: 'Opening balances',
  payables: 'Suppliers (payables)',
  grni: 'Goods received, not yet invoiced',
  expense_payables: 'Expenses payable',
  expense_default: 'Expenses (default)',
  stock_adjustment: 'Stock count differences',
  internal_use: 'Internal use of stock',
  price_variance: 'Purchase price differences',
  cogs: 'Cost of goods sold',
  sales_revenue: 'Sales revenue',
  sales_returns: 'Sales returns and allowances',
};

type RoleRow = { role: AccountRole; accountId: string | null };
type CategoryRow = { categoryId: string; name: string; accountId: string | null };
type HeadRow = { membershipId: string; userId: string; role: string; isHeadAccountant: boolean };

export function AdvancedSetup({ preview, reloadPreview }: { preview: SwitchOnPreview; reloadPreview: () => void }) {
  const session = useSession();
  const person = usePeople();
  const isOwner = session.role === 'owner';
  const canManage = useChartManager();
  const accounts = useLoad(() => api<Account[]>('/v1/accounting/accounts'));
  const roles = useLoad(() => api<RoleRow[]>('/v1/accounting/roles'));
  const categories = useLoad(() => api<CategoryRow[]>('/v1/accounting/category-accounts'));
  const heads = useLoad(() => api<HeadRow[]>('/v1/accounting/setup/head-accountants'));
  const uncosted = useLoad(() => api<UncostedReceipt[]>('/v1/accounting/setup/uncosted-receipts'));
  const { message, busy, run } = useNotice();
  const [costs, setCosts] = useState<Record<number, string>>({});
  const all = [accounts, roles, categories, heads, uncosted];
  if (all.some((x) => !x.data)) return <Loading error={all.find((x) => x.error)?.error} />;
  const p = preview;
  const list = accounts.data!;
  const currency = session.org?.defaultCurrency ?? 'EGP';

  return (
    <div className="stack">
      <Notice message={message} />

      {/* 2. roles */}
      <div className="form-card stack">
        <h2>{tr('Where each kind of document posts')}</h2>
        <p className="muted small">{tr('Each role points at one detail account. The default chart fills them all; change one only if your accountant asks.')}</p>
        {p.missingRoles.length ? <p className="error small">{trf('Not set yet: {roles}', { roles: p.missingRoles.map((r) => tr(ROLE_LABEL[r] ?? r)).join(', ') })}</p> : null}
        <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Role')}</th><th scope="col">{tr('Account')}</th></tr></thead><tbody>
          {roles.data!.map((r) => (
            <tr key={r.role}>
              <td>{tr(ROLE_LABEL[r.role] ?? r.role)}</td>
              <td>
                {canManage ? (
                  <AccountSelect accounts={list} value={r.accountId ?? ''} label={tr(ROLE_LABEL[r.role] ?? r.role)} onChange={(id) => id && run(async () => {
                    await api(`/v1/accounting/roles/${r.role}`, { method: 'PUT', body: JSON.stringify({ accountId: id }) });
                    return tr('Saved.');
                  }, () => { roles.reload(); reloadPreview(); })} />
                ) : (
                  (() => { const a = list.find((x) => x.id === r.accountId); return a ? accountLabel(a) : '—'; })()
                )}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      </div>

      {/* 3. expense categories */}
      <div className="form-card stack">
        <h2>{tr('Expense categories')}</h2>
        <p className="muted small">{tr('Each expense category can post to its own expense account. Categories left empty post to the default expense account.')}</p>
        <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Category')}</th><th scope="col">{tr('Account')}</th></tr></thead><tbody>
          {categories.data!.map((c) => (
            <tr key={c.categoryId}>
              <td>{c.name}</td>
              <td>
                {canManage ? (
                  <AccountSelect accounts={list} value={c.accountId ?? ''} empty={tr('Default expense account')} label={c.name} onChange={(id) => run(async () => {
                    await api(`/v1/accounting/category-accounts/${c.categoryId}`, { method: 'PUT', body: JSON.stringify({ accountId: id || null }) });
                    return tr('Saved.');
                  }, categories.reload)} />
                ) : (
                  (() => { const a = list.find((x) => x.id === c.accountId); return a ? accountLabel(a) : tr('Default expense account'); })()
                )}
              </td>
            </tr>
          ))}
          {!categories.data!.length && <tr><td colSpan={2} className="muted empty">{tr('No expense categories yet.')}</td></tr>}
        </tbody></table></div>
      </div>

      {/* 4. uncosted receipts */}
      <div className="form-card stack">
        <h2>{trf('Stock received without a cost ({count})', { count: uncosted.data!.length })}</h2>
        <p className="muted small">{tr('Switching on values every past receipt. These were received without a cost and not from a purchase order, so enter what each unit cost. The current average cost is shown as a guide.')}</p>
        {uncosted.data!.length ? (
          <div className="table-wrap"><table><thead><tr>
            <th scope="col">{tr('Received')}</th><th scope="col">{tr('Item')}</th><th scope="col">{tr('Warehouse')}</th><th scope="col" className="right">{tr('Quantity')}</th>
            <th scope="col">{tr('Reference')}</th><th scope="col" className="right">{tr('Current average cost')}</th><th scope="col">{tr('Unit cost')}</th>
          </tr></thead><tbody>
            {uncosted.data!.map((r) => (
              <tr key={r.moveId}>
                <td className="nowrap">{formatDateTime(r.postedAt, session.org)}</td>
                <td><code>{r.sku}</code> {r.itemName}</td>
                <td>{r.warehouseName}</td>
                <td className="right">{r.qty}</td>
                <td>{r.ref}</td>
                <td className="right">{r.currentAvgCostMinor === null ? '—' : money(r.currentAvgCostMinor, currency)}</td>
                <td>
                  {canManage ? (
                    <span className="flex items-center gap-2">
                      <input inputMode="decimal" placeholder={r.currentAvgCostMinor === null ? '0.00' : (r.currentAvgCostMinor / 100).toFixed(2)} value={costs[r.moveId] ?? ''}
                        onChange={(e) => setCosts({ ...costs, [r.moveId]: e.target.value })} aria-label={trf('Unit cost of {sku}', { sku: r.sku })} />
                      <Button size="sm" variant="outline" disabled={busy || !(costs[r.moveId] ?? '').trim() || Number.isNaN(Number(costs[r.moveId]))} onClick={() => run(async () => {
                        await api(`/v1/accounting/setup/receipt-costs/${r.moveId}`, { method: 'PUT', body: JSON.stringify({ unitCostMinor: toMinor(costs[r.moveId] ?? '') }) });
                        return trf('Cost saved for {sku}.', { sku: r.sku });
                      }, () => { uncosted.reload(); reloadPreview(); })}>{tr('Save')}</Button>
                    </span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p className="muted small">{tr('None: every receipt has a cost.')}</p>}
      </div>

      {/* 5. head accountant */}
      <div className="form-card stack">
        <h2>{tr('Head accountant')}</h2>
        <p className="muted small">{tr('The owner and the head accountant can change the chart and post journals without a second approval. Everyone else\'s journals wait for another person to approve them. Only an owner or admin can be head accountant.')}</p>
        <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Person')}</th><th scope="col">{tr('Role')}</th><th scope="col">{tr('Head accountant')}</th></tr></thead><tbody>
          {heads.data!.map((h) => (
            <tr key={h.membershipId}>
              <td>{person(h.userId)}</td>
              <td>{tr(h.role)}</td>
              <td>
                {h.role === 'owner' ? <span className="muted small">{tr('Owner (always allowed)')}</span>
                  : isOwner ? (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={h.isHeadAccountant} disabled={busy} onChange={(e) => run(async () => {
                        await api(`/v1/accounting/setup/head-accountants/${h.membershipId}`, { method: 'PUT', body: JSON.stringify({ on: e.target.checked }) });
                        return tr('Saved.');
                      }, heads.reload)} />
                      {h.isHeadAccountant ? tr('Yes') : tr('No')}
                    </label>
                  ) : (h.isHeadAccountant ? tr('Yes') : tr('No'))}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      </div>

    </div>
  );
}
