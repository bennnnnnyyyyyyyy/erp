import { useCallback, useEffect, useRef, useState } from 'react';
import { hasPermission } from '@erp/shared';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Link, navigate } from '../lib/router';
import { useSession } from '../session';

export type AppNotification = { id: string; title: string; body: string; entityType: string | null; entityId: string | null; readAt: string | null; createdAt: string };

/** Where a notification leads when clicked. */
export function notificationTarget(n: Pick<AppNotification, 'entityType' | 'entityId'>): string | null {
  if (n.entityType === 'stock_request' && n.entityId) return `/inventory/requests/${n.entityId}`;
  if (n.entityType === 'task') return '/tasks';
  return null;
}

// The bell in the top bar: unread count, the latest notifications, mark as read. Messages are delivered into this
// inbox by the delivery job; a notification can open the request or task, but it never approves or changes anything.
export function NotificationBell() {
  const session = useSession();
  const enabled = session.modules.includes('messaging') && hasPermission(session.permissions, 'messaging.notifications.read');
  const [data, setData] = useState<{ items: AppNotification[]; unread: number } | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<{ items: AppNotification[]; unread: number }>('/v1/messaging/notifications').then(setData).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [enabled, load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!enabled) return null;

  async function openItem(n: AppNotification) {
    setOpen(false);
    if (!n.readAt) await api('/v1/messaging/notifications/read', { method: 'POST', body: JSON.stringify({ id: n.id }) }).catch(() => undefined);
    load();
    const to = notificationTarget(n);
    if (to) navigate(to);
  }

  async function markAll() {
    await api('/v1/messaging/notifications/read', { method: 'POST', body: JSON.stringify({}) }).catch(() => undefined);
    load();
  }

  const unread = data?.unread ?? 0;
  return (
    <div className="bell" ref={ref}>
      <button className="icon-btn bell-btn" onClick={() => { setOpen((o) => !o); load(); }} aria-haspopup="menu" aria-expanded={open} aria-label={`Notifications, ${unread} unread`}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8" />
          <path d="M10.3 20a1.9 1.9 0 003.4 0" />
        </svg>
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="menu bell-menu" role="menu">
          <div className="bell-head">
            <strong>Notifications</strong>
            <span className="spacer" />
            {unread > 0 && <button className="link-btn" onClick={markAll}>Mark all read</button>}
          </div>
          {(data?.items ?? []).length === 0 && <p className="muted small bell-empty">Nothing yet.</p>}
          <div className="bell-list">
            {(data?.items ?? []).slice(0, 8).map((n) => (
              <button key={n.id} role="menuitem" className={n.readAt ? 'bell-item' : 'bell-item unread'} onClick={() => openItem(n)}>
                <span className="bell-title">{n.title}</span>
                {n.body && <span className="muted small">{n.body}</span>}
                <span className="muted small">{formatDateTime(n.createdAt, session.org)}</span>
              </button>
            ))}
          </div>
          <Link to="/messaging" className="bell-all" onClick={() => setOpen(false)}>See all</Link>
        </div>
      )}
    </div>
  );
}
