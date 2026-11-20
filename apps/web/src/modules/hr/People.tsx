import { useEffect, useRef, useState } from 'react';
import { hasPermission, type Branch, type HrDirectory, type HrDirectoryRow, type HrSyncStatus, type HrUnit } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { currentLanguage, tr, trf } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Notice, useNotice } from '../accounting/common';

// People (sql/102; documentation/plans/HR_APP_INTEGRATION_PLAN.md): the staff directory read from the HR & payroll app. Read-only
// here: the HR app is the source of truth. Every member sees the directory; owners and admins also see work emails and dates, link
// employees to the people who use the ERP, map HR branches to ERP branches and ask for a sync.

type Person = { userId: string; name: string };
const PAGE = 50;
const STATUS_LABEL: Record<string, string> = { active: 'Active', on_leave: 'On leave', terminated: 'Left' };

const pick = (en: string | null, ar: string | null) => (currentLanguage() === 'ar' && ar ? ar : en) ?? '';

export function PeoplePage() {
  const session = useSession();
  const canManage = hasPermission(session.permissions, 'hr.people.manage');
  const canSync = hasPermission(session.permissions, 'core.integrations.manage');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [branch, setBranch] = useState('');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE), ...(q.trim() ? { q: q.trim() } : {}), ...(status ? { status } : {}), ...(branch ? { branch } : {}) });
  const qs = query.toString();
  const dir = useLoad(() => api<HrDirectory>(`/v1/hr/employees?${qs}`));
  // useLoad reloads only when asked: ask whenever the filters change (not on the first render, which already loads)
  const first = useRef(true);
  const reloadDir = dir.reload;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (qs) reloadDir();
  }, [qs, reloadDir]);
  const units = useLoad(() => api<HrUnit[]>('/v1/hr/units'));
  const sync = useLoad(() => (canManage ? api<HrSyncStatus>('/v1/hr/status') : Promise.resolve(null)));
  const people = useLoad(() => (canManage ? api<Person[]>('/v1/core/people') : Promise.resolve([] as Person[])));
  const { message, busy, run } = useNotice();
  const reload = () => { dir.reload(); units.reload(); sync.reload(); };

  const branches = (units.data ?? []).filter((u) => u.kind === 'branch');
  const name = (id: string | null) => (people.data ?? []).find((p) => p.userId === id)?.name ?? tr('Someone');
  const last = sync.data;

  return (
    <section className="page">
      <h1>{tr('People')}</h1>
      <p className="muted">{tr('Your staff as your HR and payroll app lists them. Changes are made in the HR app and appear here within 15 minutes.')}</p>
      <Notice message={message} />

      {canManage ? (
        <div className="form-card stack">
          <p className="small">
            {last?.lastFinishedAt
              ? trf('Last read from the HR app: {when}', { when: formatDateTime(last.lastFinishedAt, session.org) })
              : tr('Not read from the HR app yet. Switch the HR app on in Settings → Integrations.')}
            {last?.lastResult === 'failed' ? <span className="error"> · {tr('It failed')}{last.lastError ? `: ${last.lastError}` : ''}</span> : null}
            {last?.lastResult === 'partial' ? <span className="muted"> · {tr('Partly read; the rest comes with the next read.')}</span> : null}
          </p>
          {canSync ? (
            <div>
              <Button variant="outline" disabled={busy} onClick={() => run(async () => {
                await api('/v1/hr/sync', { method: 'POST' });
                return tr('Asked. The HR app is read within 5 minutes.');
              }, () => sync.reload())}>{tr('Sync now')}</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="form-row">
        <label>{tr('Search')}<input value={q} placeholder={tr('Name, number or job title')} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label>{tr('Status')}
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{tr('All')}</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
          </select>
        </label>
        <label>{tr('Branch')}
          <select value={branch} onChange={(e) => { setBranch(e.target.value); setPage(1); }}>
            <option value="">{tr('All')}</option>
            {branches.map((b) => <option key={b.id} value={b.externalId}>{pick(b.name, b.nameAr)}</option>)}
          </select>
        </label>
      </div>

      {!dir.data ? <Loading error={dir.error} /> : dir.data.rows.length === 0 ? (
        <p className="muted">{dir.data.total === 0 && !q && !branch ? tr('No people yet. They appear after the first read from the HR app.') : tr('Nobody matches.')}</p>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tr('Name')}</th>
                <th scope="col">{tr('Number')}</th>
                <th scope="col">{tr('Job title')}</th>
                <th scope="col">{tr('Branch')}</th>
                <th scope="col">{tr('Department')}</th>
                <th scope="col">{tr('Manager')}</th>
                <th scope="col">{tr('Status')}</th>
                {dir.data.details ? <th scope="col">{tr('Work email')}</th> : null}
                {dir.data.details ? <th scope="col">{tr('Uses the ERP as')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {dir.data.rows.map((r) => (
                <tr key={r.id}>
                  <td>{pick(r.displayName, r.displayNameAr)}</td>
                  <td><bdi>{r.employeeNumber ?? ''}</bdi></td>
                  <td>{pick(r.jobTitle, r.jobTitleAr)}</td>
                  <td>{pick(r.branchName, r.branchNameAr)}</td>
                  <td>{pick(r.departmentName, r.departmentNameAr)}</td>
                  <td>{r.managerName ?? ''}</td>
                  <td>{tr(STATUS_LABEL[r.status] ?? r.status)}</td>
                  {dir.data!.details ? <td><bdi>{r.workEmail ?? ''}</bdi></td> : null}
                  {dir.data!.details ? (
                    <td><MemberLink row={r} people={people.data ?? []} name={name} canManage={canManage} busy={busy} run={run} onChanged={reload} /></td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-row">
            <span className="muted small">{trf('{count} people', { count: dir.data.total })}</span>
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr('Previous')}</Button>
            <Button variant="ghost" size="sm" disabled={page * PAGE >= dir.data.total} onClick={() => setPage(page + 1)}>{tr('Next')}</Button>
          </div>
        </>
      )}

      {canManage && branches.length ? <BranchMapping branches={branches} busy={busy} run={run} onChanged={() => units.reload()} /> : null}
    </section>
  );
}

type Run = ReturnType<typeof useNotice>['run'];

function MemberLink({ row, people, name, canManage, busy, run, onChanged }: {
  row: HrDirectoryRow; people: Person[]; name: (id: string | null) => string; canManage: boolean; busy: boolean; run: Run; onChanged: () => void;
}) {
  const [choice, setChoice] = useState('');
  const link = (userId: string) => run(async () => {
    await api(`/v1/hr/employees/${row.id}/link`, { method: 'PUT', body: JSON.stringify({ userId }) });
    return trf('{name} linked.', { name: row.displayName });
  }, onChanged);
  if (row.userId) {
    return (
      <span>
        {name(row.userId)}
        {!row.memberRole ? <span className="error small"> · {tr('switched off in the ERP')}</span> : null}
        {row.status === 'terminated' && row.memberRole ? <span className="error small"> · {tr('left in the HR app but can still sign in')}</span> : null}
        {canManage ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(async () => {
            await api(`/v1/hr/employees/${row.id}/link`, { method: 'DELETE' });
            return trf('{name} unlinked.', { name: row.displayName });
          }, onChanged)}>{tr('Unlink')}</Button>
        ) : null}
      </span>
    );
  }
  if (!canManage) return <span className="muted">{tr('Not linked')}</span>;
  if (row.suggestedUserId) {
    return (
      <span>
        <span className="muted small">{trf('Suggested: {name}', { name: name(row.suggestedUserId) })} </span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => link(row.suggestedUserId!)}>{tr('Confirm')}</Button>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select value={choice} aria-label={tr('ERP member')} onChange={(e) => setChoice(e.target.value)}>
        <option value="">{tr('Not linked')}</option>
        {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
      </select>
      <Button variant="outline" size="sm" disabled={busy || !choice} onClick={() => link(choice)}>{tr('Link')}</Button>
    </span>
  );
}

function BranchMapping({ branches, busy, run, onChanged }: { branches: HrUnit[]; busy: boolean; run: Run; onChanged: () => void }) {
  const erp = useLoad(() => api<Branch[]>('/v1/core/branches'));
  if (!erp.data) return <Loading error={erp.error} />;
  return (
    <div className="form-card stack">
      <h2>{tr('HR branches and ERP branches')}</h2>
      <p className="muted small">{tr('Match each branch in the HR app to a branch here. A branch with the same code is matched for you.')}</p>
      <table className="table">
        <thead><tr><th scope="col">{tr('HR app branch')}</th><th scope="col">{tr('ERP branch')}</th></tr></thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.id}>
              <td>{b.code ? <code>{b.code}</code> : null} {pick(b.name, b.nameAr)}</td>
              <td>
                <select value={b.coreBranchId ?? ''} disabled={busy} aria-label={tr('ERP branch')} onChange={(e) => run(async () => {
                  await api(`/v1/hr/units/${b.id}/branch`, { method: 'PUT', body: JSON.stringify({ coreBranchId: e.target.value || null }) });
                  return tr('Saved.');
                }, onChanged)}>
                  <option value="">{tr('Not matched')}</option>
                  {erp.data!.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
