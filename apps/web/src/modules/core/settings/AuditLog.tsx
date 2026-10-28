import { hasPermission, type AuditEntry, type Member } from '@ggo/shared';
import { ListView, type Column } from '../../../components/views/ListView';
import { api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';

export function AuditLog() {
  const session = useSession();
  const canSeeUsers = hasPermission(session.permissions, 'core.users.read');
  const entries = useLoad(() => api<AuditEntry[]>('/v1/core/audit?limit=200'));
  // Turns actor ids into emails when the viewer may see the member list.
  const members = useLoad(() => (canSeeUsers ? api<Member[]>('/v1/core/members') : Promise.resolve([] as Member[])));
  const emails = new Map((members.data ?? []).map((m) => [m.userId, m.email]));

  const columns: Column<AuditEntry>[] = [
    {
      key: 'when',
      label: 'When',
      value: (e) => e.occurred_at,
      render: (e) => <span className="nowrap">{formatDateTime(e.occurred_at, session.org)}</span>,
    },
    { key: 'who', label: 'Who', value: (e) => (e.actor_user_id ? (emails.get(e.actor_user_id) ?? e.actor_user_id) : 'System') },
    { key: 'action', label: 'Action', value: (e) => e.action, render: (e) => <code>{e.action}</code> },
    { key: 'summary', label: 'Details', value: (e) => e.summary },
  ];

  return (
    <section className="page">
      <h1>Audit log</h1>
      <p className="muted">Every change made in {session.org?.name}, newest first. Entries can't be edited or deleted.</p>
      {entries.error && <p className="error">{entries.error}</p>}
      {entries.data ? (
        <ListView title="Audit log" rows={entries.data} columns={columns} rowKey={(e) => String(e.id)} empty="No activity yet." />
      ) : (
        !entries.error && <p className="muted">Loading…</p>
      )}
    </section>
  );
}
