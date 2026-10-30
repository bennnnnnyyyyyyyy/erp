import { useState } from 'react';
import { ListView, type Column } from '../../components/views/ListView';
import { notificationTarget, type AppNotification } from '../../components/NotificationBell';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Link } from '../../lib/router';
import { usePeople } from '../../lib/people';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

// Messages: each person's notification inbox, and for owners and admins the outbox with delivery status.
// A message is only ever delivered here; approving or changing stock happens in the inventory screens.

export function NotificationsPage() {
  const session = useSession();
  const inbox = useLoad(() => api<{ items: AppNotification[]; unread: number }>('/v1/messaging/notifications'));

  async function markAll() {
    await api('/v1/messaging/notifications/read', { method: 'POST', body: JSON.stringify({}) });
    inbox.reload();
  }

  const columns: Column<AppNotification>[] = [
    { key: 'when', label: 'When', value: (n) => n.createdAt, render: (n) => <span className="nowrap">{formatDateTime(n.createdAt, session.org)}</span> },
    { key: 'title', label: 'Message', value: (n) => n.title, render: (n) => (<>{n.readAt ? n.title : <strong>{n.title}</strong>}{n.body && <div className="muted small">{n.body}</div>}</>) },
    { key: 'open', label: '', value: () => '', render: (n) => { const to = notificationTarget(n); return to ? <Link to={to}>Open</Link> : null; } },
  ];

  return (
    <section className="page">
      <h1>Notifications</h1>
      <p className="muted">Messages sent to you. Opening one takes you to the request or task; deciding still happens there.</p>
      {inbox.data ? (
        <ListView
          title="Notifications"
          rows={inbox.data.items}
          columns={columns}
          rowKey={(n) => n.id}
          empty="Nothing yet."
          toolbar={inbox.data.unread > 0 ? <button className="secondary" onClick={markAll}>Mark all read ({inbox.data.unread})</button> : undefined}
        />
      ) : (
        <p className="muted">{inbox.error ?? 'Loading…'}</p>
      )}
    </section>
  );
}

type OutboxRow = {
  id: string; recipientId: string; channel: string; kind: string; subject: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'expired' | 'cancelled';
  attempts: number; maxAttempts: number; nextAttemptAt: string; expiresAt: string; lastError: string | null; sentAt: string | null; createdAt: string;
};
type PassResult = { reminders: number; escalations: number; lowStock: number; claimed: number; sent: number; failed: number; auditCheck: string };

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
      setResult({ ok: true, text: `Reminders queued: ${r.reminders}. Escalations queued: ${r.escalations}. Low-stock messages: ${r.lowStock}. Audit check: ${r.auditCheck}. Messages delivered: ${r.sent}${r.failed ? `, failed: ${r.failed}` : ''}.` });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      outbox.reload();
    }
  }

  const columns: Column<OutboxRow>[] = [
    { key: 'when', label: 'Queued', value: (m) => m.createdAt, render: (m) => <span className="nowrap">{formatDateTime(m.createdAt, session.org)}</span> },
    { key: 'to', label: 'To', value: (m) => who(m.recipientId) },
    { key: 'kind', label: 'Kind', value: (m) => m.kind, render: (m) => <code>{m.kind}</code> },
    { key: 'subject', label: 'Message', value: (m) => m.subject, render: (m) => (<>{m.subject}{m.lastError && <div className="error small">{m.lastError}</div>}</>) },
    { key: 'channel', label: 'Channel', value: (m) => m.channel },
    { key: 'status', label: 'Status', value: (m) => m.status, render: (m) => <span className={`pill st-${m.status}`}>{m.status}</span> },
    { key: 'attempts', label: 'Tries', value: (m) => m.attempts, align: 'right', render: (m) => `${m.attempts}/${m.maxAttempts}` },
  ];

  return (
    <section className="page wide">
      <h1>Message outbox</h1>
      <p className="muted">Every message the system queued, and whether it was delivered. Failed sends are retried with a growing delay, and messages that wait too long expire. A background job runs every five minutes; you can run it now.</p>
      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}
      {outbox.data ? (
        <ListView
          title="Message outbox"
          rows={outbox.data}
          columns={columns}
          rowKey={(m) => m.id}
          empty="No messages yet."
          toolbar={<button onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run delivery and reminders now'}</button>}
        />
      ) : (
        <p className="muted">{outbox.error ?? 'Loading…'}</p>
      )}
    </section>
  );
}
