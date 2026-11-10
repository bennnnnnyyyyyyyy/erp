import { useEffect, useState, type FormEvent } from 'react';
import { hasPermission } from '@erp/shared';
import { ConfirmButton } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { RecordHistory } from '../../components/RecordHistory';
import { Button } from '../../components/ui/button';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { formatQty, parseAmount } from '../../lib/numbers';
import { usePeople } from '../../lib/people';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { useCatalog } from './Inventory';

// Stock counts (sql/042; the database and API existed, these screens did not: MVP check, 10 Nov 2026). A count for a whole
// warehouse (or chosen items): the expected quantities are a snapshot taken when it starts; people enter what they counted; when every
// line is counted it is submitted; a manager who did not start or submit it approves, and the differences become stock moves.

type CountStatus = 'counting' | 'submitted' | 'approved' | 'applied' | 'rejected' | 'cancelled';
type CountLine = { itemId: string; expectedQty: number | null; countedQty: number | null; difference: number | null; countedAt: string | null };
type Count = {
  id: string;
  number: string;
  warehouseId: string;
  note: string | null;
  status: CountStatus;
  /** Blind count (sql/066): the expected quantities are left out for this person while counting. */
  blind?: boolean;
  requesterId: string;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
  lines?: CountLine[];
};

const STATUS_LABEL: Record<CountStatus, string> = {
  counting: 'Counting',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  applied: 'Applied to stock',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
const STATUS_CLASS: Record<CountStatus, string> = {
  counting: 'st-ordered', submitted: 'st-submitted', approved: 'st-approved', applied: 'st-received', rejected: 'st-rejected', cancelled: 'st-cancelled',
};
const StatusPill = ({ status }: { status: CountStatus }) => <span className={`pill ${STATUS_CLASS[status]}`}>{tr(STATUS_LABEL[status])}</span>;
const qty = (n: number) => formatQty(n);

export function CountsList() {
  const cat = useCatalog();
  const who = usePeople();
  const session = useSession();
  const counts = useLoad(() => api<Count[]>('/v1/inventory/counts'));
  const canStart = hasPermission(session.permissions, 'inventory.adjustments.create');
  const [warehouseId, setWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const warehouses = cat.warehouses.data;
  useEffect(() => {
    if (!warehouseId && warehouses?.[0]) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  async function start(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const made = await api<Count>('/v1/inventory/counts', { method: 'POST', body: JSON.stringify({ warehouseId, note: note.trim() || null }) });
      navigate(`/inventory/counts/${made.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Count>[] = [
    { key: 'number', label: tr('Count'), value: (c) => c.number, render: (c) => <Link to={`/inventory/counts/${c.id}`}><code>{c.number}</code></Link> },
    { key: 'wh', label: tr('Warehouse'), value: (c) => cat.warehouseName(c.warehouseId) },
    { key: 'note', label: tr('Note'), value: (c) => c.note ?? '' },
    { key: 'by', label: tr('Started by'), value: (c) => who(c.requesterId) },
    { key: 'status', label: tr('Status'), value: (c) => c.status, render: (c) => <StatusPill status={c.status} /> },
    { key: 'when', label: tr('Started'), value: (c) => c.createdAt, render: (c) => <span className="nowrap">{formatDateTime(c.createdAt, session.org)}</span> },
  ];

  return (
    <section className="page wide">
      <h1>{tr('Stock counts')}</h1>
      <p className="muted">{tr('Count a whole warehouse. The differences change stock only after a manager approves them.')}</p>
      {canStart && warehouses && warehouses.length > 0 && (
        <form className="form-card stack" onSubmit={start}>
          <strong>{tr('Start a count')}</strong>
          <div className="form-row">
            <label>
              {tr('Warehouse')}
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label>{tr('Note (optional)')}<input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={tr('Month-end count')} /></label>
          </div>
          <p className="muted small">{tr('Every item in the warehouse is listed with the quantity the books show right now. Count each one and enter what you find.')}</p>
          {error && <p className="error">{error}</p>}
          <div className="form-actions"><Button type="submit" disabled={busy || !warehouseId}>{tr('Start the count')}</Button></div>
        </form>
      )}
      {counts.data && cat.ready ? (
        <ListView title={tr('Stock counts')} rows={counts.data} columns={columns} rowKey={(c) => c.id} rowHref={(c) => `/inventory/counts/${c.id}`} empty={canStart ? tr('No stock counts yet. A count checks the shelves against the books, one warehouse at a time. Use "Start a count" above.') : tr('No stock counts yet.')} />
      ) : (
        <Loading error={counts.error} />
      )}
    </section>
  );
}

/** One counted quantity, saved when the person leaves the field (or presses Enter). Blank clears it. */
function CountedCell({ count, line, onSaved, editable }: { count: Count; line: CountLine; onSaved: (c: Count) => void; editable: boolean }) {
  const initial = line.countedQty === null ? '' : String(line.countedQty);
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  useEffect(() => setValue(initial), [initial]);
  if (!editable) return <>{line.countedQty === null ? <span className="muted">—</span> : qty(line.countedQty)}</>;
  const save = async () => {
    if (value === initial) return;
    const n = value.trim() === '' ? null : parseAmount(value);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return setState('error');
    setState('saving');
    try {
      onSaved(await api<Count>(`/v1/inventory/counts/${count.id}/lines`, { method: 'PUT', body: JSON.stringify({ itemId: line.itemId, countedQty: n }) }));
      setState('idle');
    } catch {
      setState('error');
    }
  };
  return (
    <input
      className="w-24"
      inputMode="decimal"
      value={value}
      aria-invalid={state === 'error' || undefined}
      disabled={state === 'saving'}
      onChange={(e) => {
        setValue(e.target.value);
        setState('idle');
      }}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function CountPage() {
  const id = useParam('id');
  const who = usePeople();
  const session = useSession();
  const cat = useCatalog();
  const loaded = useLoad(() => api<Count>(`/v1/inventory/counts/${id}`));
  const [count, setCount] = useState<Count | null>(null);
  const [comment, setComment] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setCount(loaded.data ?? null), [loaded.data]);
  const can = (key: string) => hasPermission(session.permissions, key);

  async function act(action: 'submit' | 'approve' | 'reject' | 'cancel', done: string) {
    setBusy(true);
    setResult(null);
    try {
      setCount(await api<Count>(`/v1/inventory/counts/${id}/${action}`, { method: 'POST', body: JSON.stringify({ comment, reason: comment }) }));
      setResult({ ok: true, text: tr(done) });
      setComment('');
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (loaded.error) return <section className="page"><p className="error">{loaded.error}</p></section>;
  if (!count || !cat.ready) return <section className="page"><Loading /></section>;

  const lines = count.lines ?? [];
  const counted = lines.filter((l) => l.countedQty !== null).length;
  const differences = lines.filter((l) => l.difference !== null && l.difference !== 0);
  const shown = onlyOpen ? lines.filter((l) => l.countedQty === null) : lines;
  const editable = count.status === 'counting' && can('inventory.adjustments.create');
  const open = count.status === 'counting' || count.status === 'submitted';
  const mine = count.requesterId === session.userId;
  const blind = count.blind === true;

  return (
    <section className="page wide">
      <Link to="/inventory/counts" className="back-link">{tr('← Stock counts')}</Link>
      <div className="page-head">
        <h1 className="mono">{count.number}</h1>
        <StatusPill status={count.status} />
      </div>
      <dl className="facts">
        <div><dt>{tr('Warehouse')}</dt><dd>{cat.warehouseName(count.warehouseId)}</dd></div>
        <div><dt>{tr('Started by')}</dt><dd>{who(count.requesterId)} · {formatDateTime(count.createdAt, session.org)}</dd></div>
        {count.note && <div><dt>{tr('Note')}</dt><dd>{count.note}</dd></div>}
        <div><dt>{tr('Counted')}</dt><dd>{trf('{n} of {total} items', { n: counted, total: lines.length })}</dd></div>
        {!blind && <div><dt>{tr('Differences')}</dt><dd>{differences.length}</dd></div>}
        {count.submittedBy && <div><dt>{tr('Submitted by')}</dt><dd>{who(count.submittedBy)}</dd></div>}
        {count.decidedBy && <div><dt>{tr('Decision by')}</dt><dd>{who(count.decidedBy)}{count.decisionComment ? <span className="muted"> · “{count.decisionComment}”</span> : ''}</dd></div>}
      </dl>

      {editable && <p className="muted small">{tr('Type the quantity you counted for each item; it is saved when you leave the field. Leave it empty to clear it.')}</p>}
      {blind && <p className="notice">{tr('This is a blind count: count what is on the shelf. The quantities the books expect are shown to managers when they approve.')}</p>}
      {lines.length > 0 && (
        <label className="inline-check"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> {tr('Show only items not counted yet')}</label>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{tr('Item')}</th>
              {!blind && <th scope="col" className="right">{tr('In the books')}</th>}
              <th scope="col" className="right">{tr('Counted')}</th>
              {!blind && <th scope="col" className="right">{tr('Difference')}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.itemId}>
                <td>{cat.itemName(l.itemId)}</td>
                {!blind && <td className="right">{l.expectedQty === null ? '—' : qty(l.expectedQty)}</td>}
                <td className="right"><CountedCell count={count} line={l} onSaved={setCount} editable={editable} /></td>
                {!blind && (
                  <td className={`right ${l.difference !== null && l.difference < 0 ? 'overdue' : ''}`}>
                    {l.difference === null ? <span className="muted">—</span> : l.difference > 0 ? `+${qty(l.difference)}` : qty(l.difference)}
                  </td>
                )}
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={blind ? 2 : 4} className="muted">{lines.length === 0 ? tr('This warehouse has no items to count.') : tr('Every item is counted.')}</td></tr>}
          </tbody>
        </table>
      </div>

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {count.status === 'counting' && can('inventory.adjustments.create') && (
        <div className="form-actions">
          <ConfirmButton
            label={tr('Submit for approval')}
            confirmLabel={tr('Yes, submit')}
            disabled={busy || counted < lines.length || lines.length === 0}
            question={blind
              ? tr('Submit the count? Nobody can change the counted quantities after this.')
              : trf('Submit the count with {n} difference(s)? Nobody can change the counted quantities after this.', { n: differences.length })}
            onConfirm={() => act('submit', 'Submitted. A manager now has to approve it.')}
          />
          {counted < lines.length && <span className="muted small">{trf('{n} item(s) still to count', { n: lines.length - counted })}</span>}
        </div>
      )}

      {count.status === 'submitted' && can('inventory.adjustments.approve') && (
        <div className="form-card stack">
          <strong>{tr('Manager decision')}</strong>
          <p className="muted small">{tr('Approving changes stock by each difference. If you started or submitted this count, another owner or manager must approve it, unless you are the only one.')}</p>
          <label>{tr('Comment (optional)')}<input value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="form-actions">
            <ConfirmButton label={tr('Approve')} confirmLabel={tr('Yes, change the stock')} disabled={busy}
              question={trf('Change stock by the {n} difference(s) of this count?', { n: differences.length })}
              onConfirm={() => act('approve', 'Approved. The differences were applied to stock.')} />
            <Button variant="outline" type="submit" disabled={busy} onClick={() => act('reject', 'Rejected. Stock was not changed.')}>{tr('Reject')}</Button>
          </div>
        </div>
      )}
      {count.status === 'submitted' && !can('inventory.adjustments.approve') && <p className="notice">{tr('Waiting for a manager to approve.')}</p>}

      {open && (mine || can('inventory.adjustments.approve')) && can('inventory.adjustments.create') && (
        <div className="form-actions">
          <ConfirmButton label={tr('Cancel count')} confirmLabel={tr('Yes, cancel it')} disabled={busy} question={tr('Cancel this count? Stock is not changed.')}
            onConfirm={() => act('cancel', 'Count cancelled. Stock was not changed.')} />
        </div>
      )}

      <RecordHistory key={`${count.id}:${count.status}`} id={count.id} />
    </section>
  );
}
