import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';

import { tr, trf } from '../../lib/i18n';
// Alert rules (sql/028). A rule says "when this happens, tell these people". Rules only send messages; they never change stock
// or approve anything. The rules are checked every five minutes. Owners and admins only.

type Recipient = { type: 'team' | 'role' | 'user'; id?: string; role?: string };
type Rule = { id: string; name: string; kind: Kind; itemId: string | null; threshold: number | null; repeatHours: number; enabled: boolean; recipients: Recipient[]; timesFired: number; lastFiredAt: string | null };
type Team = { id: string; name: string; userIds: string[] };
type Person = { userId: string; name: string };
type Item = { id: string; sku: string; name: string };
type Kind = 'stock_below' | 'expiry_within' | 'receivable_overdue' | 'profit_negative' | 'forecast_stockout';

const KIND: Record<Kind, { label: string; hint: string; unit?: string }> = {
  stock_below: { label: 'Stock is running low', hint: 'Leave the number empty to use each item\'s own reorder level.', unit: 'units or fewer available' },
  expiry_within: { label: 'A batch is about to expire', hint: 'Also tells you about batches that already expired.', unit: 'days before expiry' },
  receivable_overdue: { label: 'A customer invoice is late', hint: 'Counted from the invoice date.', unit: 'days after the invoice date' },
  profit_negative: { label: 'The month is losing money', hint: 'Sales minus cost of goods minus expenses, this month so far.' },
  forecast_stockout: { label: 'An item will run out soon (forecast)', hint: 'Uses the Stock forecast: the message says how many days are left and how reliable the guess is. Items nobody used in 90 days are ignored.', unit: 'days of stock left, or fewer' },
};
const ROLE_LABEL: Record<string, string> = { owner: 'All owners', admin: 'All admins', member: 'All staff', viewer: 'All viewers' };

export function AlertsPage() {
  const session = useSession();
  const rules = useLoad(() => api<Rule[]>('/v1/alerts/rules'));
  const teams = useLoad(() => api<Team[]>('/v1/alerts/teams'));
  const people = useLoad(() => api<Person[]>('/v1/core/people'));
  const items = useLoad(() => api<Item[]>('/v1/inventory/items'));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', kind: 'stock_below' as Kind, itemId: '', threshold: '', repeatHours: '24', to: '' });
  const [teamName, setTeamName] = useState('');
  const canManage = session.permissions.includes('alerts.rules.manage');

  async function run(work: () => Promise<string>, after: () => void) {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await work() }); after(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  const reloadAll = () => { rules.reload(); teams.reload(); };

  if (!rules.data || !teams.data || !people.data || !items.data) return <section className="page"><p className="muted">{rules.error ?? teams.error ?? tr('Loading…')}</p></section>;
  const person = (id?: string) => people.data?.find((p) => p.userId === id)?.name ?? 'Someone';
  // The rule description, built in the language in use: the sentence pieces are translated and the numbers and names are filled in.
  const ruleText = (r: Rule) => {
    const k = KIND[r.kind];
    const base = tr(k.label);
    if (r.kind === 'stock_below') return `${base} (${itemLabel(r.itemId)}${r.threshold !== null ? trf(', {n} or fewer', { n: r.threshold }) : tr(', at its reorder level')})`;
    if (r.kind === 'forecast_stockout') return `${base} (${itemLabel(r.itemId)}): ${r.threshold} ${tr(k.unit ?? '')}`;
    return r.threshold !== null ? `${base}: ${r.threshold} ${tr(k.unit ?? '')}` : base;
  };
  const recipientLabel = (r: Recipient) => (r.type === 'team' ? trf('Team: {name}', { name: teams.data?.find((t) => t.id === r.id)?.name ?? '?' }) : r.type === 'role' ? tr(ROLE_LABEL[r.role ?? ''] ?? r.role ?? '') : person(r.id));
  const recipientOptions = [
    ...teams.data.map((t) => ({ value: `team:${t.id}`, label: trf('Team: {name}', { name: t.name }) })),
    ...Object.entries(ROLE_LABEL).map(([role, label]) => ({ value: `role:${role}`, label: tr(label) })),
    ...people.data.map((p) => ({ value: `user:${p.userId}`, label: p.name })),
  ];
  const itemLabel = (id: string | null) => (id ? (() => { const i = items.data?.find((x) => x.id === id); return i ? `${i.sku} · ${i.name}` : 'one item'; })() : 'every item');
  const needsNumber = f.kind === 'expiry_within' || f.kind === 'receivable_overdue' || f.kind === 'forecast_stockout';
  const parse = (to: string): Recipient => { const [type, id] = to.split(':'); return type === 'role' ? { type: 'role', role: id } : { type: type as 'team' | 'user', id }; };

  return (
    <section className="page wide">
      <h1>{tr('Alerts')}</h1>
      <p className="muted">{tr('Rules tell the right people when something needs attention. They are checked every five minutes, and the same thing is not repeated until the "repeat after" time has passed (unless it gets clearly worse). Alerts arrive as notifications; WhatsApp comes later.')}</p>
      {msg && <p className={msg.ok ? 'notice' : 'error notice'}>{msg.text}</p>}

      <h2 className="related">{tr('Rules')}</h2>
      <p className="muted small">{tr('What you are told about, and who is told. Each rule is checked every five minutes against the current stock, batches and invoices.')}</p>
      <div className="table-wrap"><table><thead><tr><th>{tr('Rule')}</th><th>{tr('When')}</th><th>{tr('Who is told')}</th><th>{tr('Repeat after')}</th><th>{tr('Fired')}</th><th>{tr('State')}</th><th></th></tr></thead><tbody>
        {rules.data.map((r) => (
          <tr key={r.id}><td>{r.name}</td>
            <td>{ruleText(r)}</td>
            <td>{r.recipients.map(recipientLabel).join(', ')}</td><td>{r.repeatHours} h</td>
            <td>{r.timesFired}{r.lastFiredAt ? <span className="muted small"> {tr('· last')} {formatDateTime(r.lastFiredAt, session.org)}</span> : ''}</td>
            <td><Pill status={r.enabled ? 'received' : 'cancelled'} label={r.enabled ? tr('On') : tr('Off')} /></td>
            <td>{canManage && <span className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/alerts/rules/${r.id}/enabled`, { method: 'POST', body: JSON.stringify({ enabled: !r.enabled }) }); return `${r.name}: ${r.enabled ? 'off' : 'on'}.`; }, reloadAll)}>{r.enabled ? tr('Turn off') : tr('Turn on')}</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/alerts/rules/${r.id}/test`, { method: 'POST' }); return 'A test message was sent to you (see Messages).'; }, () => undefined)}>{tr('Send me a test')}</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/alerts/rules/${r.id}/retire`, { method: 'POST' }); return trf('{name} removed (kept in the history).', { name: r.name }); }, reloadAll)}>{tr('Remove')}</Button>
            </span>}</td></tr>
        ))}
        {!rules.data.length && <tr><td colSpan={7} className="muted empty">{tr('No rules yet. Add one below.')}</td></tr>}
      </tbody></table></div>

      {canManage && (
        <div className="form-card stack">
          <h2>{tr('Add a rule')}</h2>
          <div className="form-row">
            <label>{tr('Name')}<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tr('e.g. Glycerin running low')} /></label>
            <label>{tr('Tell me when')}
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind, threshold: '' })}>
                {(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{tr(KIND[k].label)}</option>)}
              </select>
            </label>
            {(f.kind === 'stock_below' || f.kind === 'forecast_stockout') && (
              <label>{tr('For')}
                <select value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">{tr('Every item')}</option>{items.data.map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}</select>
              </label>
            )}
            {KIND[f.kind].unit && <label>{needsNumber ? tr('Number') : tr('Number (optional)')} ({tr(KIND[f.kind].unit ?? '')})<input inputMode="decimal" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} /></label>}
          </div>
          <p className="muted small">{tr(KIND[f.kind].hint)}</p>
          <div className="form-row">
            <label>{tr('Who is told')}
              <select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="">{tr('Choose…')}</option>{recipientOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </label>
            <label>{tr('Repeat after (hours)')}<input inputMode="numeric" value={f.repeatHours} onChange={(e) => setF({ ...f, repeatHours: e.target.value })} /></label>
          </div>
          <div><Button disabled={busy || !f.name.trim() || !f.to || (needsNumber && f.threshold === '')} onClick={() => run(async () => {
            await api('/v1/alerts/rules', { method: 'POST', body: JSON.stringify({ name: f.name, kind: f.kind, itemId: f.itemId, threshold: f.threshold === '' ? null : Number(f.threshold), repeatHours: Number(f.repeatHours) || 24, recipients: [parse(f.to)] }) });
            return trf('Rule "{name}" added.', { name: f.name.trim() });
          }, () => { setF({ ...f, name: '', threshold: '', to: '' }); reloadAll(); })}>{busy ? tr('Saving…') : tr('Add rule')}</Button></div>
        </div>
      )}

      <h2 className="related">{tr('Teams')}</h2>
      <p className="muted small">{tr('A team is a named group (Purchasing, Warehouse, Management) so a rule can say "tell Purchasing". Whoever buys stock belongs in Purchasing.')}</p>
      {teams.data.length === 0 && canManage && <Button variant="outline" disabled={busy} onClick={() => run(async () => { await api('/v1/alerts/defaults', { method: 'POST' }); return 'Purchasing, Warehouse and Management teams created.'; }, reloadAll)}>{tr('Create the standard teams')}</Button>}
      {teams.data.map((t) => (
        <div key={t.id} className="form-card stack">
          <strong>{t.name}</strong>
          <div className="form-row">
            {(people.data ?? []).map((p) => {
              const on = t.userIds.includes(p.userId);
              return <label key={p.userId} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={on} disabled={busy || !canManage}
                  onChange={() => run(async () => { await api(`/v1/alerts/teams/${t.id}/members`, { method: 'PUT', body: JSON.stringify({ userIds: on ? t.userIds.filter((x) => x !== p.userId) : [...t.userIds, p.userId] }) }); return trf('{name} updated.', { name: t.name }); }, reloadAll)} />
                {p.name}</label>;
            })}
          </div>
        </div>
      ))}
      {canManage && (
        <div className="form-row">
          <label>{tr('New team')}<input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder={tr('e.g. Quality')} /></label>
          <Button variant="outline" disabled={busy || !teamName.trim()} onClick={() => run(async () => { await api('/v1/alerts/teams', { method: 'POST', body: JSON.stringify({ name: teamName }) }); return trf('Team "{name}" added.', { name: teamName.trim() }); }, () => { setTeamName(''); reloadAll(); })}>{tr('Add team')}</Button>
        </div>
      )}
    </section>
  );
}
