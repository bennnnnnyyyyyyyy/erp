import { useState } from 'react';
import { NOTE_MAX_CHARS, type NoteEntityType, type RecordNote, hasPermission } from '@erp/shared';
import { ApiError, api } from '../lib/api';
import { demoMode } from '../lib/demo';
import { formatDateTime } from '../lib/format';
import { tr } from '../lib/i18n';
import { usePeople } from '../lib/people';
import { useLoad } from '../lib/useLoad';
import { useSession } from '../session';
import { ConfirmButton } from './FormToggle';
import { Button } from './ui/button';

// Notes panel (sql/113; Ben's decisions 25 Nov 2026): short notes on a record, beside its attachments. Whoever can see the record reads
// them; owners, admins and members add one; the writer deletes their own, owners and admins delete any (a soft delete, kept in the
// history). Hidden while the database update is not applied.

export function Notes({ entityType, entityId }: { entityType: NoteEntityType; entityId: string }) {
  const session = useSession();
  const canRead = !demoMode && hasPermission(session.permissions, 'core.notes.read');
  const canAdd = hasPermission(session.permissions, 'core.notes.add');
  // Before sql/113 the API answers 503 not_set_up: then the panel is not shown at all.
  const list = useLoad<RecordNote[] | 'not_set_up'>(() =>
    canRead && entityId
      ? api<RecordNote[]>(`/v1/core/notes?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`).catch((e) => {
          if (e instanceof ApiError && e.code === 'not_set_up') return 'not_set_up' as const;
          throw e;
        })
      : Promise.resolve([] as RecordNote[]),
  );
  const notes = Array.isArray(list.data) ? list.data : null;
  const who = usePeople();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!canRead) return null;
  if (list.data === 'not_set_up') return null;

  async function act(work: () => Promise<unknown>, done: string, after?: () => void) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage({ ok: true, text: tr(done) });
      after?.();
      list.reload();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const add = () =>
    act(
      () => api('/v1/core/notes', { method: 'POST', body: JSON.stringify({ entityType, entityId, body: text.trim() }) }),
      'Note added.',
      () => setText(''),
    );
  const mayDelete = (n: RecordNote) => canAdd && (n.createdBy === session.userId || session.role === 'owner' || session.role === 'admin');

  return (
    <section className="notes">
      <h2 className="related">{tr('Notes')}</h2>
      {message ? (
        <p className={message.ok ? 'notice' : 'error notice'} role={message.ok ? undefined : 'alert'}>
          {message.text}
        </p>
      ) : null}
      {canAdd ? (
        <div className="form-row">
          <label className="grow">
            <span className="sr-only">{tr('Write a note')}</span>
            <textarea value={text} rows={2} maxLength={NOTE_MAX_CHARS} placeholder={tr('Write a note for your team…')} onChange={(e) => setText(e.target.value)} />
          </label>
          <Button variant="outline" size="sm" disabled={busy || !text.trim()} onClick={() => void add()}>
            {tr('Add note')}
          </Button>
        </div>
      ) : null}
      {list.error ? <p className="error small">{list.error}</p> : null}
      <ul className="note-list">
        {(notes ?? []).map((n) => (
          <li key={n.id}>
            <p className="note-body">{n.body}</p>
            <span className="muted small">
              {who(n.createdBy)} · {formatDateTime(n.createdAt, session.org)}
            </span>
            {mayDelete(n) ? (
              <ConfirmButton
                size="sm"
                label={tr('Delete')}
                confirmLabel={tr('Yes, delete')}
                question={tr('Delete this note? It is kept in the history.')}
                disabled={busy}
                onConfirm={() => void act(() => api(`/v1/core/notes/${n.id}`, { method: 'DELETE' }), 'Note deleted.')}
              />
            ) : null}
          </li>
        ))}
        {notes && !notes.length ? <li className="muted small">{tr('No notes yet.')}</li> : null}
      </ul>
    </section>
  );
}
