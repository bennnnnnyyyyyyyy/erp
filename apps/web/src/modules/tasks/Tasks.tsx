import { useState, type FormEvent } from 'react';
import { hasPermission, type Member } from '@erp/shared';
import { Modal } from '../../components/Modal';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { usePeople } from '../../lib/people';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

// Tasks (documentation/plans/TASKS_AND_OUTBOX_PLAN.md): a manager assigns work with a due time; the assignee gets a
// notification, updates the status, and a reminder goes out if it is overdue. Rules live in the database.

type Task = {
  id: string; title: string; description: string; assigneeId: string; createdBy: string; dueAt: string | null;
  status: 'open' | 'in_progress' | 'done' | 'cancelled'; completedAt: string | null; createdAt: string;
};

const STATUS_LABEL: Record<Task['status'], string> = { open: 'To do', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' };

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
    { key: 'title', label: 'Task', value: (t) => t.title, render: (t) => (<><strong>{t.title}</strong>{t.description && <div className="muted small">{t.description}</div>}</>) },
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
                {t.status === 'open' && <button className="secondary" onClick={() => setStatus(t, 'in_progress')}>Start</button>}{' '}
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
