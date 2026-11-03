import { hasPermission, type AuditEntry } from '@erp/shared';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { tr } from '../lib/i18n';
import { usePeople } from '../lib/people';
import { useLoad } from '../lib/useLoad';
import { readableAction } from '../modules/core/settings/AuditLog';
import { useSession } from '../session';

// The History section of a record's page: its audit-log entries, newest first. The API is asked for this record only (?entity=); the
// list is also filtered here, so an API without that filter (older deploy) still shows the right rows from the latest 200.
// Shown only to people who may read the audit log.

export function RecordHistory({ id }: { id: string }) {
  const session = useSession();
  const allowed = hasPermission(session.permissions, 'core.audit.read');
  const entries = useLoad(() => (allowed && id ? api<AuditEntry[]>(`/v1/core/audit?limit=200&entity=${encodeURIComponent(id)}`) : Promise.resolve([] as AuditEntry[])));
  const who = usePeople();
  if (!allowed) return null;
  const rows = (entries.data ?? []).filter((e) => e.entity_id === id);
  return (
    <>
      <h2 className="related">{tr('History')}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr('When')}</th><th>{tr('Who')}</th><th>{tr('Action')}</th><th>{tr('Details')}</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{formatDateTime(e.occurred_at, session.org)}</td>
                <td>{e.actor_user_id ? who(e.actor_user_id) : tr('System')}</td>
                <td><span title={e.action}>{readableAction(e.action)}</span></td>
                <td>{e.summary}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="muted empty">{entries.data ? tr('No history yet.') : tr('Loading…')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
