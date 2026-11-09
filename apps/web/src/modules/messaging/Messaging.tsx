import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { ListView, type Column } from '../../components/views/ListView';
import { notificationTarget, type AppNotification } from '../../components/NotificationBell';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Link } from '../../lib/router';
import { usePeople } from '../../lib/people';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

import { tr, trf } from '../../lib/i18n';
// Messages: each person's notification inbox, and for owners and admins the outbox with delivery status.
// A message is only ever delivered here; approving or changing stock happens in the inventory screens.

export function NotificationsPage() {
  const session = useSession();
  const inbox = useLoad(() => api<{ items: AppNotification[]; unread: number }>('/v1/messaging/notifications'));

  const [markError, setMarkError] = useState<string | null>(null);
  async function markAll() {
    setMarkError(null);
    try {
      await api('/v1/messaging/notifications/read', { method: 'POST', body: JSON.stringify({}) });
      inbox.reload();
    } catch (err) {
      setMarkError((err as Error).message);
    }
  }

  const columns: Column<AppNotification>[] = [
    { key: 'when', label: tr('When'), value: (n) => n.createdAt, render: (n) => <span className="nowrap">{formatDateTime(n.createdAt, session.org)}</span> },
    { key: 'title', label: tr('Message'), value: (n) => n.title, render: (n) => (<>{n.readAt ? n.title : <strong>{n.title}</strong>}{n.body && <div className="muted small">{n.body}</div>}</>) },
    { key: 'open', label: '', value: () => '', render: (n) => { const to = notificationTarget(n); return to ? <Link to={to}>{tr('Open')}</Link> : null; } },
  ];

  return (
    <section className="page">
      <h1>{tr('Notifications')}</h1>
      <p className="muted">{tr('Your notifications. Each one opens the related request or task.')}</p>
      {markError && <p className="error notice">{markError}</p>}
      {inbox.data ? (
        <ListView
          title={tr('Notifications')}
          rows={inbox.data.items}
          columns={columns}
          rowKey={(n) => n.id}
          empty={tr('Nothing yet.')}
          toolbar={inbox.data.unread > 0 ? <Button variant="outline" type="submit" onClick={markAll}>{tr('Mark all read (')}{inbox.data.unread})</Button> : undefined}
        />
      ) : (
        <Loading error={inbox.error} />
      )}
    </section>
  );
}

type OutboxRow = {
  id: string; recipientId: string | null; channel: string; kind: string; subject: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'expired' | 'cancelled';
  attempts: number; maxAttempts: number; nextAttemptAt: string; expiresAt: string; lastError: string | null; sentAt: string | null; createdAt: string;
  /** How it was delivered (sql/053): simulated, resend, slack-webhook … */
  deliveredVia?: string | null;
};
type PassResult = { reminders: number; escalations: number; lowStock: number; alerts: number; claimed: number; sent: number; failed: number; auditCheck: string };

// Plain words for the outbox's stored codes (UX audit: the list showed `approval_request` and `pending`).
const KIND_LABEL: Record<string, string> = {
  approval_request: 'Approval request', decision: 'Decision', task_assigned: 'Task assigned', task_update: 'Task update',
  reminder: 'Reminder', escalation: 'Escalation', alert: 'Alert', info: 'Notice',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed', expired: 'Expired', cancelled: 'Cancelled',
};

export function OutboxPage() {
  const session = useSession();
  const who = usePeople();
  const outbox = useLoad(() => api<OutboxRow[]>('/v1/messaging/outbox'));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<PassResult>('/v1/messaging/process', { method: 'POST' });
      setResult({ ok: true, text: trf('Done. {sent} messages sent; {queued} reminders and alerts added to the queue.', { sent: r.sent, queued: r.reminders + r.escalations + r.lowStock + r.alerts }) + (r.failed ? ` ${trf('{n} could not be sent; they will be tried again.', { n: r.failed })}` : '') });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      outbox.reload();
    }
  }

  const columns: Column<OutboxRow>[] = [
    { key: 'when', label: tr('Queued'), value: (m) => m.createdAt, render: (m) => <span className="nowrap">{formatDateTime(m.createdAt, session.org)}</span> },
    { key: 'to', label: tr('To'), value: (m) => (m.recipientId ? who(m.recipientId) : tr('Company channel')) },
    { key: 'kind', label: tr('Kind'), value: (m) => m.kind, render: (m) => tr(KIND_LABEL[m.kind] ?? m.kind) },
    { key: 'subject', label: tr('Message'), value: (m) => m.subject, render: (m) => (<>{m.subject}{m.lastError && <div className="error small">{m.lastError}</div>}</>) },
    { key: 'channel', label: tr('Channel'), value: (m) => m.channel, render: (m) => (<>{m.channel}{m.deliveredVia && m.deliveredVia !== m.channel ? <div className="muted small">{m.deliveredVia}</div> : null}</>) },
    { key: 'status', label: tr('Status'), value: (m) => m.status, render: (m) => <span className={`pill st-${m.status}`}>{tr(STATUS_LABEL[m.status] ?? m.status)}</span> },
    { key: 'attempts', label: tr('Attempts'), value: (m) => m.attempts, align: 'right', render: (m) => `${m.attempts}/${m.maxAttempts}` },
  ];

  return (
    <section className="page wide">
      <h1>{tr('Message outbox')}</h1>
      <p className="muted">{tr('Outgoing messages and their delivery status.')}</p>
      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}
      {outbox.data ? (
        <ListView
          title={tr('Message outbox')}
          rows={outbox.data}
          columns={columns}
          rowKey={(m) => m.id}
          empty={tr('No messages yet.')}
          toolbar={<Button type="submit" onClick={run} disabled={busy}>{busy ? tr('Sending…') : tr('Send waiting messages now')}</Button>}
        />
      ) : (
        <Loading error={outbox.error} />
      )}
    </section>
  );
}
