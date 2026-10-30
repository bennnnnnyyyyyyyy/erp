import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

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

  async function run(work: () => Promise<string>) {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await work() }); identities.reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  if (!identities.data) return <section className="page"><p className="muted">{identities.error ?? 'Loading…'}</p></section>;

  return (
    <section className="page">
      <h1>Connect your WhatsApp</h1>
      <p className="muted">Approve or reject stock requests and answer tasks from WhatsApp. Every answer is saved with who gave it and from which number. Only a number you have confirmed here is trusted.</p>
      {msg && <p className={msg.ok ? 'notice' : 'error notice'}>{msg.text}</p>}

      <div className="form-card stack">
        <h2>Add a number</h2>
        <label>WhatsApp number with country code<input inputMode="tel" placeholder="+20 100 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <div><Button disabled={busy || phone.replace(/\D/g, '').length < 8} onClick={() => run(async () => {
          await api('/v1/messaging/identities', { method: 'POST', body: JSON.stringify({ channel: 'whatsapp', address: phone }) });
          setPhone('');
          return 'A 6-digit code was queued for that number. Type it below when it arrives (valid 10 minutes, 5 tries).';
        })}>Send me a code</Button></div>
      </div>

      <h2 className="related">Your numbers</h2>
      <div className="table-wrap"><table><thead><tr><th>Number</th><th>Status</th><th>Added</th><th>Confirm</th><th></th></tr></thead><tbody>
        {identities.data.map((i) => (
          <tr key={i.id}><td><code>{i.address}</code></td><td>{i.status === 'verified' ? 'Confirmed' : 'Waiting for the code'}</td><td>{formatDateTime(i.createdAt, session.org)}</td>
            <td>{i.status === 'pending' && (
              <span className="form-row">
                <input aria-label="6-digit code" inputMode="numeric" maxLength={6} placeholder="123456" value={codes[i.id] ?? ''} onChange={(e) => setCodes((c) => ({ ...c, [i.id]: e.target.value }))} />
                <Button size="sm" disabled={busy || (codes[i.id] ?? '').length !== 6} onClick={() => run(async () => {
                  const r = await api<{ confirmed: boolean }>(`/v1/messaging/identities/${i.id}/confirm`, { method: 'POST', body: JSON.stringify({ code: codes[i.id] }) });
                  return r.confirmed ? 'Number confirmed.' : 'That code is not right. Check it and try again.';
                })}>Confirm</Button>
              </span>
            )}</td>
            <td><Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/messaging/identities/${i.id}/revoke`, { method: 'POST' }); return 'Number removed.'; })}>Remove</Button></td></tr>
        ))}
        {!identities.data.length && <tr><td colSpan={5} className="muted empty">No numbers yet.</td></tr>}
      </tbody></table></div>
    </section>
  );
}
