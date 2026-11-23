import { useMemo, useState } from 'react';
import { hasPermission } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { api } from '../../lib/api';
import { mayDecide, OWN_REQUEST_TEXT } from '../../lib/approvals';
import { demoMode } from '../../lib/demo';
import type { DemoRequest } from '../../lib/demoInventory';
import { formatDateTime } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { usePeople } from '../../lib/people';
import { Link, navigate } from '../../lib/router';
import { usePaged } from '../../lib/usePaged';
import { useSession } from '../../session';
import { StatusPill, useCatalog } from './inventoryShared';
import '../sales/pagekit.css';

// New UI (plan of 23 Nov 2026): the approvals workspace in three versions (Design Lab "Approvals"). Approving stays exactly as before:
// the same POST /v1/inventory/requests/:id/approve | reject with an optional comment, the same rule that a person does not approve their
// own request (lib/approvals.ts mayDecide, read only), and the database function decides and writes the audit row. Only the layout differs.
//   A  Workspace (Dynamics): counts that filter, ready-made filters at the side, the picked request beside the list with its decision.
//   B  One at a time: one request large, Approve / Reject / Skip, then the next (like approving on WhatsApp).
//   C  Decide in the list: each waiting row has its own Approve and Reject.
const VERSIONS = ['A', 'B', 'C'] as const;
type Filter = 'waiting' | 'approved' | 'decided' | 'all';

export function ApprovalsNew() {
  const version = useLabChoice('approvals', VERSIONS, 'A');
  const session = useSession();
  const cat = useCatalog();
  const who = usePeople();
  const requests = usePaged<DemoRequest>('/v1/inventory/requests', 200);
  const isManager = hasPermission(session.permissions, 'inventory.request.approve');
  const [filter, setFilter] = useState<Filter>('waiting');
  const [sel, setSel] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const all = requests.data ?? [];
  const counts = {
    waiting: all.filter((r) => r.status === 'submitted').length,
    approved: all.filter((r) => r.status === 'approved').length,
    decided: all.filter((r) => r.status === 'issued' || r.status === 'rejected').length,
    all: all.length,
  };
  const rows = useMemo(
    () => all.filter((r) => (filter === 'waiting' ? r.status === 'submitted' : filter === 'approved' ? r.status === 'approved' : filter === 'decided' ? r.status === 'issued' || r.status === 'rejected' : true)),
    [all, filter],
  );

  async function decide(r: DemoRequest, action: 'approve' | 'reject') {
    setBusy(r.id);
    setResult(null);
    try {
      await api(`/v1/inventory/requests/${r.id}/${action}`, { method: 'POST', body: JSON.stringify({ comment }) });
      setResult({ id: r.id, ok: true, text: action === 'approve' ? trf('{n} approved. The stock can now be sent out.', { n: r.number }) : trf('{n} rejected. The reserved stock was released.', { n: r.number }) });
      setComment('');
    } catch (err) {
      setResult({ id: r.id, ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
      requests.reload();
    }
  }

  if (requests.error) return <section className="page"><p className="error">{requests.error}</p></section>;
  if (!requests.data || !cat.ready) return <section className="page"><Loading /></section>;

  const lines = (r: DemoRequest) => r.lines.map((l) => `${cat.itemName(l.itemId)} × ${l.qty}`).join(', ');
  const age = (iso: string) => {
    const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3600000));
    return h < 24 ? trf('{n} h ago', { n: h }) : trf('{n} days ago', { n: Math.round(h / 24) });
  };
  /** Who may decide this one: a manager, and not the requester (unless the company allows it). The database checks again. */
  const canDecide = (r: DemoRequest) => r.status === 'submitted' && isManager && (demoMode || mayDecide(session, r.requesterId));
  const ownNote = (r: DemoRequest) => (r.status === 'submitted' && isManager && !canDecide(r) ? <p className="pk-muted">{tr(OWN_REQUEST_TEXT)}</p> : null);
  const message = (r: DemoRequest) => (result && result.id === r.id ? <p className={result.ok ? 'notice' : 'error notice'} role="status">{result.text}</p> : null);
  const decisionBox = (r: DemoRequest, big = false) =>
    canDecide(r) ? (
      <div className={big ? 'ap-decide ap-decide-big' : 'ap-decide'}>
        <label className="ap-comment"><span>{tr('Comment (optional)')}</span><input value={comment} onChange={(e) => setComment(e.target.value)} /></label>
        <div className="ap-buttons">
          <button type="button" className="pk-act pk-act-main" disabled={busy === r.id} onClick={() => decide(r, 'approve')}>{tr('Approve')}</button>
          <button type="button" className="pk-act ap-reject" disabled={busy === r.id} onClick={() => decide(r, 'reject')}>{tr('Reject')}</button>
        </div>
      </div>
    ) : null;
  const detail = (r: DemoRequest, big = false) => (
    <>
      <p className="pk-side-title"><Link to={`/inventory/requests/${r.id}`}><code>{r.number}</code></Link> <StatusPill status={r.status} /></p>
      <dl className="pk-dl">
        <div><dt>{tr('Requested by')}</dt><dd>{who(r.requesterId)}</dd></div>
        <div><dt>{tr('Warehouse')}</dt><dd>{cat.warehouseName(r.warehouseId)}</dd></div>
        <div><dt>{tr('Requested')}</dt><dd>{formatDateTime(r.createdAt, session.org)}</dd></div>
        <div><dt>{tr('Reason')}</dt><dd>{r.reason || '—'}</dd></div>
        {r.source && <div><dt>{tr('Sales order')}</dt><dd><code>{r.source.number}</code></dd></div>}
      </dl>
      <ul className="pk-lines-mini">{r.lines.map((l, i) => <li key={i}><span>{cat.itemName(l.itemId)}</span><span className="pk-num">{l.qty}</span></li>)}</ul>
      {ownNote(r)}
      {decisionBox(r, big)}
      {message(r)}
    </>
  );
  const notManager = !isManager && <p className="notice">{tr('Only owners and managers decide requests. You can see them here.')}{demoMode && tr(' Switch to Layla Hassan or Karim Adel in the yellow bar to approve.')}</p>;

  if (version === 'B') {
    const queue = all.filter((r) => r.status === 'submitted' && !skipped.includes(r.id));
    const r = queue[0];
    const done = counts.waiting - queue.length;
    return (
      <section className="page pk ap-one">
        <div className="pk-head"><h1>{tr('Approvals')}</h1><span className="pk-muted">{counts.waiting ? trf('{n} waiting', { n: counts.waiting }) : ''}</span></div>
        {notManager}
        {r ? (
          <article className="ap-card">
            <p className="pk-label">{trf('{n} of {total} waiting', { n: done + 1, total: counts.waiting })} · {age(r.createdAt)}</p>
            <h2 className="ap-title">{trf('{who} wants to take out {what}', { who: who(r.requesterId), what: lines(r) })}</h2>
            <p className="pk-muted">{cat.warehouseName(r.warehouseId)}{r.reason ? ` · “${r.reason}”` : ''} · <Link to={`/inventory/requests/${r.id}`}><code>{r.number}</code></Link></p>
            {ownNote(r)}
            {decisionBox(r, true)}
            <button type="button" className="pk-link ap-skip" onClick={() => { setSkipped((s) => [...s, r.id]); setComment(''); }}>{tr('Skip for now')}</button>
          </article>
        ) : (
          <div className="ap-done"><p className="ap-title">{tr('Nothing waits for your decision.')}</p>{skipped.length > 0 && <button type="button" className="pk-link" onClick={() => setSkipped([])}>{trf('Show the {n} you skipped', { n: skipped.length })}</button>}</div>
        )}
        {result && <p className={result.ok ? 'notice' : 'error notice'} role="status">{result.text}</p>}
      </section>
    );
  }
  const filterTabs = (
    <div className="pk-tabs" role="tablist" aria-label={tr('Filters')}>
      {([['waiting', 'Waiting for a decision'], ['approved', 'Approved, not sent out'], ['decided', 'Decided'], ['all', 'All']] as [Filter, string][]).map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'pk-tab active' : 'pk-tab'} onClick={() => { setFilter(k); setSel(null); }}>
          {tr(label)} <span className="pk-group-n">{counts[k]}</span>
        </button>
      ))}
    </div>
  );
  if (version === 'C') {
    return (
      <section className="page pk pk-wide">
        <div className="pk-head"><h1>{tr('Approvals')}</h1></div>
        {notManager}
        {filterTabs}
        <table className="pk-table">
          <thead><tr><th scope="col">{tr('Request')}</th><th scope="col">{tr('Who and what')}</th><th scope="col">{tr('Waiting')}</th><th scope="col" className="pk-num">{tr('Decision')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/inventory/requests/${r.id}`}><code>{r.number}</code></Link></td>
                <td><strong>{who(r.requesterId)}</strong> · {lines(r)}<div className="pk-muted">{cat.warehouseName(r.warehouseId)}{r.reason ? ` · “${r.reason}”` : ''}</div>{message(r)}</td>
                <td className="nowrap">{age(r.createdAt)}</td>
                <td className="pk-num">
                  {canDecide(r) ? (
                    <span className="ap-inline">
                      <button type="button" className="pk-act pk-act-main" disabled={busy === r.id} onClick={() => decide(r, 'approve')}>{tr('Approve')}</button>
                      <button type="button" className="pk-act ap-reject" disabled={busy === r.id} onClick={() => decide(r, 'reject')}>{tr('Reject')}</button>
                    </span>
                  ) : r.status === 'submitted' && isManager ? <span className="pk-muted">{tr('Someone else decides')}</span> : <StatusPill status={r.status} />}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="pk-empty">{tr('Nothing here.')}</td></tr>}
          </tbody>
        </table>
      </section>
    );
  }
  const picked = rows.find((r) => r.id === sel) ?? rows[0] ?? null;
  return (
    <section className="page pk pk-wide">
      <div className="pk-head"><h1>{tr('Approvals')}</h1></div>
      {notManager}
      <div className="pk-strip">
        <div><span>{tr('Waiting for a decision')}</span><strong>{counts.waiting}</strong></div>
        <div><span>{tr('Approved, not sent out')}</span><strong>{counts.approved}</strong></div>
        <div><span>{tr('Oldest waiting')}</span><strong>{(() => { const w = all.filter((r) => r.status === 'submitted').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]; return w ? age(w.createdAt) : '—'; })()}</strong></div>
      </div>
      {filterTabs}
      <div className="pk-with-side">
        <table className="pk-table">
          <thead><tr><th scope="col">{tr('Request')}</th><th scope="col">{tr('Requested by')}</th><th scope="col">{tr('Items')}</th><th scope="col">{tr('Waiting')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={picked?.id === r.id ? 'pk-sel' : undefined} onClick={() => setSel(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(r.id)} aria-selected={picked?.id === r.id}>
                <td><code>{r.number}</code></td>
                <td>{who(r.requesterId)}</td>
                <td>{lines(r)}</td>
                <td className="nowrap">{age(r.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="pk-empty">{tr('Nothing here.')}</td></tr>}
          </tbody>
        </table>
        <aside className="pk-side" aria-label={tr('Selected request')}>{picked ? detail(picked) : <p className="pk-empty">{tr('Pick a request.')}</p>}</aside>
      </div>
      <p className="pk-muted"><button type="button" className="pk-link" onClick={() => navigate('/inventory/requests')}>{tr('All stock requests')} →</button></p>
    </section>
  );
}
