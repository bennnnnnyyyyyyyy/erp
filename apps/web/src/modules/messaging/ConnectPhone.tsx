import { useState } from 'react';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

import { tr, trf } from '../../lib/i18n';
// Connect your WhatsApp number (sql/008). A one-time code is sent to the number; type it back to prove it is yours. Until
// then nothing is ever sent to it and nobody can approve in your name. Real delivery needs the WhatsApp provider set up by
// an administrator; until then the code is queued in the outbox but not delivered.

type Identity = { id: string; channel: string; address: string; status: 'pending' | 'verified' | 'revoked'; verifiedAt: string | null; createdAt: string };

export function ConnectPhonePage() {
  const session = useSession();
  const identities = useLoad(() => api<Identity[]>('/v1/messaging/identities'));
  const [phone, setPhone] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null);

  async function run(work: () => Promise<string>) {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await work() }); identities.reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  if (!identities.data) return <section className="page"><Loading error={identities.error} /></section>;
  const telegram = identities.data.find((i) => i.channel === 'telegram' && i.status === 'verified');
  const numbers = identities.data.filter((i) => i.channel !== 'telegram');

  return (
    <section className="page">
      <h1>{tr('Connect your WhatsApp')}</h1>
      <p className="muted">{tr('Approve requests and answer tasks from WhatsApp.')}</p>
      {msg && <p className={msg.ok ? 'notice' : 'error notice'}>{msg.text}</p>}

      <div className="form-card stack">
        <h2>{tr('Add a number')}</h2>
        <label>{tr('WhatsApp number with country code')}<input inputMode="tel" placeholder="+20 100 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <div><Button disabled={busy || phone.replace(/\D/g, '').length < 8} onClick={() => run(async () => {
          await api('/v1/messaging/identities', { method: 'POST', body: JSON.stringify({ channel: 'whatsapp', address: phone }) });
          setPhone('');
          return tr('A 6-digit code was queued for that number. Type it below when it arrives (valid 10 minutes, 5 tries).');
        })}>{tr('Send me a code')}</Button></div>
      </div>

      {/* Telegram (sql/054): one tap links your Telegram to this company; messages then arrive there with an "Open in the app" button. */}
      <div className="form-card stack">
        <h2>{tr('Telegram')}</h2>
        {telegram ? (
          <div className="form-row">
            <span>{trf('Linked since {date}.', { date: formatDateTime(telegram.verifiedAt ?? telegram.createdAt, session.org) })}</span>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/messaging/identities/${telegram.id}/revoke`, { method: 'POST' }); return tr('Telegram unlinked.'); })}>{tr('Unlink')}</Button>
          </div>
        ) : (
          <p className="muted small">{tr('Get your messages on Telegram too. Press the button, then press Start in Telegram. The link works once, for 10 minutes.')}</p>
        )}
        <div className="form-row">
          <Button variant={telegram ? 'outline' : 'default'} disabled={busy} onClick={() => run(async () => {
            const r = await api<{ url: string }>('/v1/messaging/telegram/link', { method: 'POST' });
            setTelegramUrl(r.url);
            window.open(r.url, '_blank', 'noopener');
            return tr('Telegram opened. Press Start there, then come back and refresh this page.');
          })}>{telegram ? tr('Link a different Telegram') : tr('Connect Telegram')}</Button>
          {telegramUrl ? <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className="small">{tr('Open the link again')}</a> : null}
        </div>
      </div>

      <h2 className="related">{tr('Your numbers')}</h2>
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Number')}</th><th scope="col">{tr('Status')}</th><th scope="col">{tr('Added')}</th><th scope="col">{tr('Confirm')}</th><th scope="col"></th></tr></thead><tbody>
        {numbers.map((i) => (
          <tr key={i.id}><td><code>{i.address}</code></td><td>{i.status === 'verified' ? tr('Confirmed') : tr('Waiting for the code')}</td><td>{formatDateTime(i.createdAt, session.org)}</td>
            <td>{i.status === 'pending' && (
              <span className="form-row">
                <input aria-label={tr('6-digit code')} inputMode="numeric" maxLength={6} placeholder="123456" value={codes[i.id] ?? ''} onChange={(e) => setCodes((c) => ({ ...c, [i.id]: e.target.value }))} />
                <Button size="sm" disabled={busy || (codes[i.id] ?? '').length !== 6} onClick={() => run(async () => {
                  const r = await api<{ confirmed: boolean }>(`/v1/messaging/identities/${i.id}/confirm`, { method: 'POST', body: JSON.stringify({ code: codes[i.id] }) });
                  // A wrong code is an error, not a green success (UX audit).
                  if (!r.confirmed) throw new Error(tr('That code is not right. Check it and try again.'));
                  return tr('Number confirmed.');
                })}>{tr('Confirm')}</Button>
              </span>
            )}</td>
            <td><Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/messaging/identities/${i.id}/revoke`, { method: 'POST' }); return 'Number removed.'; })}>{tr('Remove')}</Button></td></tr>
        ))}
        {!numbers.length && <tr><td colSpan={5} className="muted empty">{tr('No numbers yet.')}</td></tr>}
      </tbody></table></div>
    </section>
  );
}
