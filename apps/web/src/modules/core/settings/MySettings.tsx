import { useState, type FormEvent } from 'react';
import { hasPermission } from '@erp/shared';
import { Button } from '../../../components/ui/button';
import { demoMode } from '../../../lib/demo';
import { useI18n, type Lang, tr, trf } from '../../../lib/i18n';
import { Link } from '../../../lib/router';
import { supabase } from '../../../lib/supabase';
import { useSession } from '../../../session';

// Settings > My settings (decision D10, 9 Nov 2026): what every person controls for themselves. Staff see only this page in Settings;
// company pages (General, Users, Branches, Apps, Audit log) are for owners and managers.

// Same names as Settings > Users.
const ROLE_NAME: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

function ChangePassword() {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setMessage({ ok: false, text: tr('Use at least 8 characters.') });
    if (password !== again) return setMessage({ ok: false, text: tr('The two passwords are not the same.') });
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage({ ok: false, text: error.message });
    setPassword('');
    setAgain('');
    setMessage({ ok: true, text: tr('Password changed. Use it the next time you sign in.') });
  }
  return (
    <form className="stack" onSubmit={save}>
      <div className="form-row">
        <label>{tr('New password')}<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label>{tr('New password again')}<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
      </div>
      {message ? <p className={message.ok ? 'notice' : 'error'}>{message.text}</p> : null}
      <div className="form-actions"><Button type="submit" variant="outline" disabled={busy || !password}>{busy ? tr('Saving…') : tr('Change password')}</Button></div>
    </form>
  );
}

export function MySettings() {
  const session = useSession();
  const { t, personalLang, orgLang, setPersonalLang } = useI18n();
  const canLinkPhone = session.modules.includes('messaging') && hasPermission(session.permissions, 'messaging.notifications.read');
  return (
    <section className="page">
      <h1>{tr('My settings')}</h1>
      <p className="muted">{tr('Only for you. Company settings are kept by the owner and managers.')}</p>

      <div className="form-card stack">
        <h2>{tr('My language')}</h2>
        <label>
          {t('My language')}
          <select value={personalLang ?? ''} onChange={(e) => setPersonalLang(e.target.value === '' ? null : (e.target.value as Lang))}>
            <option value="">{t('Company default')} ({orgLang === 'ar' ? 'العربية' : 'English'})</option>
            <option value="en">{t('English (left to right)')}</option>
            <option value="ar">{t('Arabic (right to left)')}</option>
          </select>
          <span className="hint muted">{tr('Only for you, on every device you sign in on.')}</span>
        </label>
      </div>

      <div className="form-card stack">
        <h2>{tr('My account')}</h2>
        <dl className="facts">
          {session.name ? <div><dt>{tr('Name')}</dt><dd>{session.name}</dd></div> : null}
          <div><dt>{tr('Email')}</dt><dd><bdi>{session.email}</bdi></dd></div>
          {session.role ? <div><dt>{tr('Role')}</dt><dd>{trf('{role} at {company}', { role: tr(ROLE_NAME[session.role] ?? session.role), company: session.org?.name ?? '' })}</dd></div> : null}
        </dl>
        {demoMode ? null : <ChangePassword />}
      </div>

      <div className="form-card stack">
        <h2>{tr('My notifications')}</h2>
        <p className="small">{tr('Approvals, tasks and alerts for you appear in the bell at the top of every page.')}</p>
        <p className="small">
          {canLinkPhone ? tr('Link your phone below to also get them on Telegram.') : null}{' '}
          {tr('Choosing which messages you get is coming later.')}
        </p>
      </div>

      {canLinkPhone ? (
        <div className="form-card stack">
          <h2>{tr('Connect my phone')}</h2>
          <p className="small">{tr('Link your Telegram so messages reach you on your phone. Decisions are still made in the app.')}</p>
          <p><Link to="/messaging/whatsapp">{tr('Connect my phone')} →</Link></p>
        </div>
      ) : null}
    </section>
  );
}
