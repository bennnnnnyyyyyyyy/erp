import { useState } from 'react';
import {
  fingerprints,
  hasPermission,
  readStatement,
  STATEMENT_DATE_FORMATS,
  type StatementDateFormat,
  type StatementLine,
  type StatementMapping,
  type StatementRowError,
  type TreasuryAccount,
} from '@erp/shared';
import { ConfirmButton } from '../../components/FormToggle';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import type { Category } from './statementTypes';
import { tr } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { money } from '../accounting/common';

// ------------------------------------------------------------------ rules and who may reconcile (sql/068)

export type Rule = { id: string; accountId: string | null; contains: string; categoryId: string; note: string | null };
export const BANK_CHARGES = '__bank_charges';

/** "When the bank text contains X, it is an expense in category Y": offered as a one-click suggestion on money-out lines. */
export function Rules({ banks, canEdit }: { banks: TreasuryAccount[]; canEdit: boolean }) {
  const rules = useLoad(() => api<Rule[]>('/v1/treasury/statements/rules'));
  const categories = useLoad(() => api<Category[]>('/v1/finance/categories').catch(() => [] as Category[]));
  const [contains, setContains] = useState('');
  const [categoryId, setCategoryId] = useState(BANK_CHARGES);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? '…';
  const bankName = (id: string | null) => (id ? (banks.find((b) => b.id === id)?.name ?? '…') : tr('Every bank account'));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      rules.reload();
      categories.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const add = () => act(async () => {
    const cat = categoryId === BANK_CHARGES
      ? (await api<{ categoryId: string }>('/v1/treasury/statements/bank-charges/prepare', { method: 'POST' })).categoryId
      : categoryId;
    await api('/v1/treasury/statements/rules', { method: 'POST', body: JSON.stringify({ contains: contains.trim(), categoryId: cat, accountId: accountId || undefined }) });
    setContains('');
  });

  return (
    <>
      <h2 className="related">{tr('Rules')}</h2>
      <p className="muted small">{tr('When a money-out line contains this text, offer to record it as an expense in this category with one click. Nothing is recorded without a click.')}</p>
      {rules.error && <p className="error">{rules.error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{tr('The text contains')}</th><th scope="col">{tr('Expense category')}</th><th scope="col">{tr('Bank account')}</th>{canEdit && <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>}</tr></thead>
          <tbody>
            {(rules.data ?? []).map((r) => (
              <tr key={r.id}>
                <td><bdi>{r.contains}</bdi></td>
                <td>{catName(r.categoryId)}</td>
                <td>{bankName(r.accountId)}</td>
                {canEdit && <td className="right"><ConfirmButton size="sm" label={tr('Delete')} confirmLabel={tr('Delete')} question={tr('Delete this rule?')} disabled={busy} onConfirm={() => act(() => api(`/v1/treasury/statements/rules/${r.id}`, { method: 'DELETE' }))} /></td>}
              </tr>
            ))}
            {rules.data && rules.data.length === 0 && <tr><td colSpan={canEdit ? 4 : 3} className="muted">{tr('No rules yet.')}</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="form-card form-row">
          <label>{tr('The text contains')}<input value={contains} maxLength={100} onChange={(e) => setContains(e.target.value)} placeholder={tr('for example: COMMISSION')} /></label>
          <label>
            {tr('Expense category')}
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value={BANK_CHARGES}>{tr('Bank charges (created if missing)')}</option>
              {(categories.data ?? []).filter((c) => c.name.toLowerCase() !== 'bank charges').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            {tr('Bank account')}
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{tr('Every bank account')}</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select>
          </label>
          <Button disabled={busy || contains.trim().length < 2} onClick={add}>{tr('Add rule')}</Button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

export const ROLE_CHOICES = ['owner', 'admin', 'head_accountant'] as const;

/** Who may match, ignore and close statements (default: owner and head accountant). Only the owner changes it; the owner always stays. */
export function ReconcileRoles({ isOwner }: { isOwner: boolean }) {
  const saved = useLoad(() => api<{ roles: string[] }>('/v1/treasury/statements/reconcile-roles'));
  const [roles, setRoles] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const current = roles ?? saved.data?.roles ?? [];
  const label: Record<string, string> = { owner: 'Owner', admin: 'Admin', head_accountant: 'Head accountant' };
  if (saved.error) return null; // not set up yet, or no access: nothing to show

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/v1/treasury/statements/reconcile-roles', { method: 'PUT', body: JSON.stringify({ roles: current }) });
      saved.reload();
      setRoles(null);
      setMsg({ ok: true, text: tr('Saved.') });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="related">{tr('Who may reconcile')}</h2>
      <p className="muted small">{tr('These roles may match, ignore and close bank statements. Others can only look.')}</p>
      <fieldset className="form-row" disabled={!isOwner || busy}>
        <legend className="sr-only">{tr('Who may reconcile')}</legend>
        {ROLE_CHOICES.map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="checkbox" checked={r === 'owner' || current.includes(r)} disabled={r === 'owner'}
              onChange={(e) => setRoles(e.target.checked ? [...current.filter((x) => x !== r), r] : current.filter((x) => x !== r))} />
            {tr(label[r] ?? r)}
          </label>
        ))}
        {isOwner && <Button size="sm" disabled={busy || roles === null} onClick={save}>{tr('Save')}</Button>}
      </fieldset>
      {!isOwner && <p className="muted small">{tr('Only the owner can change this.')}</p>}
      {msg && <p className={msg.ok ? 'success' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </>
  );
}
