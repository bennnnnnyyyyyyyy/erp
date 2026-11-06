import { hasPermission, type AuditEntry, type Member } from '@erp/shared';
import { Loading } from '../../../components/Loading';
import { ListView, type Column } from '../../../components/views/ListView';
import { api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';

import { tr, trf } from '../../../lib/i18n';
import { usePeople } from '../../../lib/people';

/** 'organization.tutorial_changed' becomes 'Organization: tutorial changed'. The raw key stays in the tooltip and the CSV. */
export function readableAction(key: string): string {
  const [area, ...rest] = key.replace(/_/g, ' ').split('.');
  const text = [area, rest.join(' ')].filter(Boolean);
  const first = text[0] ? tr(text[0].charAt(0).toUpperCase() + text[0].slice(1)) : key;
  // The whole phrase ("rule created") if it has an Arabic text, else word by word; English stays exactly as before.
  const phrase = (s: string) => (tr(s) !== s ? tr(s) : s.split(' ').map((w) => tr(w)).join(' '));
  const detail = text[1];
  return detail ? `${first}: ${phrase(detail)}` : first;
}

export function AuditLog() {
  const session = useSession();
  const canSeeUsers = hasPermission(session.permissions, 'core.users.read');
  const entries = useLoad(() => api<AuditEntry[]>('/v1/core/audit?limit=200'));
  // Turns actor ids into emails when the viewer may see the member list.
  const members = useLoad(() => (canSeeUsers ? api<Member[]>('/v1/core/members') : Promise.resolve([] as Member[])));
  const emails = new Map((members.data ?? []).map((m) => [m.userId, m.email]));
  const who = usePeople();

  const columns: Column<AuditEntry>[] = [
    {
      key: 'when',
      label: tr('When'),
      value: (e) => e.occurred_at,
      render: (e) => <span className="nowrap">{formatDateTime(e.occurred_at, session.org)}</span>,
    },
    {
      key: 'who',
      label: tr('User'),
      value: (e) => {
        if (!e.actor_user_id) return tr('System');
        const name = who(e.actor_user_id);
        // 'Someone' means the person is no longer in the people list (disabled): fall back to the email, then the id.
        return name === 'Someone' ? (emails.get(e.actor_user_id) ?? e.actor_user_id) : name;
      },
    },
    { key: 'action', label: tr('Action'), value: (e) => e.action, render: (e) => <span title={e.action}>{readableAction(e.action)}</span> },
    { key: 'summary', label: tr('Details'), value: (e) => e.summary },
  ];

  return (
    <section className="page">
      <h1>{tr('Audit log')}</h1>
      <p className="muted">{trf('Append-only record of every change in {org}, newest first. Entries cannot be edited or deleted.', { org: session.org?.name ?? '' })}</p>
      {entries.error && <p className="error">{entries.error}</p>}
      {entries.data ? (
        <ListView title={tr('Audit log')} rows={entries.data} columns={columns} rowKey={(e) => String(e.id)} empty={tr('No activity yet.')} />
      ) : (
        !entries.error && <Loading />
      )}
    </section>
  );
}
