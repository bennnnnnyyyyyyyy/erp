import { useState, type FormEvent } from 'react';
import { hasPermission, type AuditEntry, type Member } from '@erp/shared';
import { Modal } from '../../components/Modal';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { usePeople } from '../../lib/people';
import { Link, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

// Tasks (documentation/plans/TASKS_AND_OUTBOX_PLAN.md): a manager assigns work with a due time; the assignee gets a
// notification, updates the status, and a reminder goes out if it is overdue. Rules live in the database.

type Task = {
  id: string; title: string; description: string; assigneeId: string; createdBy: string; dueAt: string | null;
  status: 'open' | 'in_progress' | 'done' | 'cancelled'; completedAt: string | null; createdAt: string;
};

const STATUS_LABEL: Record<Task['status'], string> = { open: 'To do', in_progress: 'Acknowledged', done: 'Done', cancelled: 'Cancelled' };

function NewTaskModal({ members, onClose, onDone }: { members: Member[]; onClose: () => void; onDone: () => void }) {
  const choices = members.filter((m) => m.status !== 'disabled');
  const [form, setForm] = useState({ title: '', assigneeId: choices[0]?.userId ?? '', dueAt: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/v1/tasks', { method: 'POST', body: JSON.stringify(form) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New task" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>What needs doing<input required value={form.title} onChange={set('title')} placeholder="Count aisle 4" /></label>
        <div className="form-row">
          <label>
            For
            <select required value={form.assigneeId} onChange={set('assigneeId')}>
              {choices.map((m) => <option key={m.userId} value={m.userId}>{m.name ?? m.email} ({m.role})</option>)}
            </select>
          </label>
          <label>Due<input type="datetime-local" value={form.dueAt} onChange={set('dueAt')} /></label>
        </div>
        <label>Details (optional)<input value={form.description} onChange={set('description')} /></label>
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><button type="submit" disabled={busy}>{busy ? 'Assigning…' : 'Assign task'}</button></div>
      </form>
    </Modal>
  );
}

export function TasksPage() {
  const session = useSession();
  const who = usePeople();
  const tasks = useLoad(() => api<Task[]>('/v1/tasks'));
  const members = useLoad(() => api<Member[]>('/v1/core/members'));
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCreate = hasPermission(session.permissions, 'tasks.tasks.create');
  const isManager = session.role === 'owner' || session.role === 'admin';

  const rows = (tasks.data ?? []).filter((t) => view === 'all' || t.assigneeId === session.userId);

  async function setStatus(t: Task, status: 'in_progress' | 'done' | 'cancelled') {
    setError(null);
    try {
      await api(`/v1/tasks/${t.id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    } catch (err) {
      setError((err as Error).message);
    }
    tasks.reload();
  }

  const overdue = (t: Task) => Boolean(t.dueAt) && (t.status === 'open' || t.status === 'in_progress') && new Date(t.dueAt as string).getTime() < Date.now();

  const columns: Column<Task>[] = [
    { key: 'title', label: 'Task', value: (t) => t.title, render: (t) => (<><Link to={`/tasks/${t.id}`}><strong>{t.title}</strong></Link>{t.description && <div className="muted small">{t.description}</div>}</>) },
    { key: 'for', label: 'For', value: (t) => who(t.assigneeId) },
    { key: 'by', label: 'Assigned by', value: (t) => who(t.createdBy) },
    { key: 'due', label: 'Due', value: (t) => t.dueAt ?? '', render: (t) => (t.dueAt ? <span className={overdue(t) ? 'overdue nowrap' : 'nowrap'}>{formatDateTime(t.dueAt, session.org)}{overdue(t) ? ' (overdue)' : ''}</span> : <span className="muted">none</span>) },
    { key: 'status', label: 'Status', value: (t) => t.status, render: (t) => <span className={`pill st-${t.status}`}>{STATUS_LABEL[t.status]}</span> },
  ];

  const canAct = (t: Task) => (t.status === 'open' || t.status === 'in_progress') && (t.assigneeId === session.userId || t.createdBy === session.userId || isManager);

  return (
    <section className="page">
      <h1>Tasks</h1>
      <p className="muted">Work assigned to people, with a due time. An overdue task triggers a reminder to the assignee and then an escalation to whoever assigned it.</p>
      {error && <p className="error notice">{error}</p>}
      {tasks.data && members.data ? (
        <ListView
          title="Tasks"
          rows={rows}
          columns={columns}
          rowKey={(t) => t.id}
          empty={view === 'mine' ? 'Nothing assigned to you.' : 'No tasks yet.'}
          toolbar={
            <>
              <select className="narrow-select" value={view} onChange={(e) => setView(e.target.value as 'mine' | 'all')} aria-label="Show">
                <option value="mine">My tasks</option>
                <option value="all">All tasks</option>
              </select>
              {canCreate && <button onClick={() => setAdding(true)}>New task</button>}
            </>
          }
          actions={(t) =>
            canAct(t) ? (
              <>
                {t.status === 'open' && <button className="secondary" onClick={() => setStatus(t, 'in_progress')}>Acknowledge</button>}{' '}
                <button onClick={() => setStatus(t, 'done')}>Done</button>{' '}
                <button className="secondary" onClick={() => setStatus(t, 'cancelled')}>Cancel</button>
              </>
            ) : null
          }
        />
      ) : (
        <p className="muted">{tasks.error ?? members.error ?? 'Loading…'}</p>
      )}
      {adding && members.data && <NewTaskModal members={members.data} onClose={() => setAdding(false)} onDone={() => { setAdding(false); tasks.reload(); }} />}
    </section>
  );
}

// Task details: where a task notification leads. The assignee acknowledges (so the manager knows it was seen) and
// completes it here. Opening the page changes nothing; each button calls the database function with the person's rights.
export function TaskPage() {
  const id = useParam('id');
  const session = useSession();
  const who = usePeople();
  const task = useLoad(() => api<Task>(`/v1/tasks/${id}`));
  const audit = useLoad(() => api<AuditEntry[]>('/v1/core/audit?limit=200'));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const t = task.data;
  const isManager = session.role === 'owner' || session.role === 'admin';

  async function act(status: 'in_progress' | 'done' | 'cancelled', done: string) {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/tasks/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      setResult({ ok: true, text: done });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      task.reload();
      audit.reload();
    }
  }

  if (task.error) return <section className="page"><Link to="/tasks" className="back-link">← Tasks</Link><p className="error">{task.error}</p></section>;
  if (!t) return <section className="page"><p className="muted">Loading…</p></section>;

  const open = t.status === 'open' || t.status === 'in_progress';
  const canAct = open && (t.assigneeId === session.userId || t.createdBy === session.userId || isManager);
  const late = Boolean(t.dueAt) && open && new Date(t.dueAt as string).getTime() < Date.now();
  const history = (audit.data ?? []).filter((a) => a.entity_id === t.id);

  return (
    <section className="page">
      <Link to="/tasks" className="back-link">← Tasks</Link>
      <div className="page-head">
        <h1>{t.title}</h1>
        <span className={`pill st-${t.status}`}>{STATUS_LABEL[t.status]}</span>
      </div>
      <p className="muted">
        For {who(t.assigneeId)}, assigned by {who(t.createdBy)} on {formatDateTime(t.createdAt, session.org)}.
        {t.dueAt && <> Due <span className={late ? 'overdue' : undefined}>{formatDateTime(t.dueAt, session.org)}{late ? ' (overdue)' : ''}</span>.</>}
        {t.completedAt && <> Completed {formatDateTime(t.completedAt, session.org)}.</>}
      </p>
      {t.description && <p>{t.description}</p>}

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {canAct && (
        <div className="form-card stack">
          <strong>{t.assigneeId === session.userId ? 'Your task' : 'Task actions'}</strong>
          <p className="hint muted small">Acknowledge tells {who(t.createdBy)} you have seen it and are on it. Complete when it is done.</p>
          <div className="form-actions">
            {t.status === 'open' && <button className="secondary" disabled={busy} onClick={() => act('in_progress', 'Acknowledged. The person who assigned it can see that you are on it.')}>Acknowledge</button>}
            <button disabled={busy} onClick={() => act('done', 'Marked as done. The person who assigned it will be notified.')}>Complete</button>
            <button className="secondary" disabled={busy} onClick={() => act('cancelled', 'Task cancelled.')}>Cancel task</button>
          </div>
        </div>
      )}

      <h2 className="related">History</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {history.map((a) => (
              <tr key={a.id}>
                <td className="nowrap">{formatDateTime(a.occurred_at, session.org)}</td>
                <td>{who(a.actor_user_id)}</td>
                <td><code>{a.action}</code></td>
                <td>{a.summary}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={4} className="muted empty">No history yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
