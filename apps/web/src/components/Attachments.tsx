import { type ChangeEvent, useRef, useState } from 'react';
import { type Attachment, type AttachmentEntityType, hasPermission } from '@erp/shared';
import { ApiError, api } from '../lib/api';
import { demoMode } from '../lib/demo';
import { formatDateTime } from '../lib/format';
import { tr, trf } from '../lib/i18n';
import { usePeople } from '../lib/people';
import { useLoad } from '../lib/useLoad';
import { useSession } from '../session';
import { ConfirmButton } from './FormToggle';
import { Button } from './ui/button';

// Attachments panel (sql/108; SCANNING_PLAN.md step 3): photos and PDFs on a record. Everyone in the company sees them; owners, admins
// and members add them (camera or file); the person who added one, or an owner or admin, removes it (a soft delete, the file is kept).
// Links last five minutes, so the list is read again when a link is opened late. Hidden while the database update is not applied.

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function Attachments({ entityType, entityId }: { entityType: AttachmentEntityType; entityId: string }) {
  const session = useSession();
  const canRead = !demoMode && hasPermission(session.permissions, 'core.attachments.read');
  const canAdd = hasPermission(session.permissions, 'core.attachments.add');
  // Before sql/108 the API answers 503 not_set_up: then the panel is not shown at all.
  const list = useLoad<Attachment[] | 'not_set_up'>(() =>
    canRead && entityId
      ? api<Attachment[]>(`/v1/core/attachments?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`).catch((e) => {
          if (e instanceof ApiError && e.code === 'not_set_up') return 'not_set_up' as const;
          throw e;
        })
      : Promise.resolve([] as Attachment[]),
  );
  const files = Array.isArray(list.data) ? list.data : null;
  const who = usePeople();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!canRead) return null;
  if (list.data === 'not_set_up') return null;

  async function upload(f: File) {
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', f);
      form.append('entityType', entityType);
      form.append('entityId', entityId);
      await api('/v1/core/attachments', { method: 'POST', body: form });
      setMessage({ ok: true, text: tr('File attached.') });
      list.reload();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void upload(f);
  };
  async function remove(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/v1/core/attachments/${id}`, { method: 'DELETE' });
      setMessage({ ok: true, text: tr('File removed.') });
      list.reload();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const mayRemove = (a: Attachment) => canAdd && (a.uploadedBy === session.userId || session.role === 'owner' || session.role === 'admin');

  return (
    <section className="attachments">
      <h2 className="related">{tr('Attachments')}</h2>
      {message ? (
        <p className={message.ok ? 'notice' : 'error notice'} role={message.ok ? undefined : 'alert'}>
          {message.text}
        </p>
      ) : null}
      {canAdd ? (
        <div className="form-row">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => cameraRef.current?.click()}>
            {tr('Take a photo')}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {tr('Choose a picture or PDF')}
          </Button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={pick} />
          {busy ? <span className="muted small">{tr('Uploading…')}</span> : null}
        </div>
      ) : null}
      {list.error ? <p className="error small">{list.error}</p> : null}
      <ul className="attachment-list">
        {(files ?? []).map((a) => (
          <li key={a.id}>
            {a.url ? (
              <a href={a.url} target="_blank" rel="noreferrer" className="attachment-thumb" aria-label={trf('Open {name}', { name: a.fileName ?? tr('the file') })}>
                {a.mime.startsWith('image/') ? <img src={a.url} alt="" loading="lazy" /> : <span>PDF</span>}
              </a>
            ) : (
              <span className="attachment-thumb">{a.mime === 'application/pdf' ? 'PDF' : '—'}</span>
            )}
            <div className="attachment-meta">
              <span>{a.fileName ?? tr('File')}</span>
              <span className="muted small">
                {size(a.bytes)} · {formatDateTime(a.createdAt, session.org)} · {who(a.uploadedBy)}
              </span>
            </div>
            {mayRemove(a) ? (
              <ConfirmButton
                size="sm"
                label={tr('Remove')}
                confirmLabel={tr('Yes, remove')}
                question={tr('Remove this file from the record? It is kept in the history.')}
                disabled={busy}
                onConfirm={() => void remove(a.id)}
              />
            ) : null}
          </li>
        ))}
        {files && !files.length ? <li className="muted small">{tr('No files attached yet.')}</li> : null}
      </ul>
    </section>
  );
}
