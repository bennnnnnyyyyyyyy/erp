import { useState } from 'react';
import { hasPermission, type ModuleStatus } from '@erp/shared';
import { api } from '../../../lib/api';
import { useLoad } from '../../../lib/useLoad';
import { useReloadSession, useSession } from '../../../session';

import { tr, trf } from '../../../lib/i18n';
import { ConfirmButton } from '../../../components/FormToggle';
import { Button } from '../../../components/ui/button';
import { Link } from '../../../lib/router';
// Switch modules on or off for the organization. Data is kept when a module is switched off.
export function AppsSettings() {
  const session = useSession();
  const reloadSession = useReloadSession();
  const canEdit = hasPermission(session.permissions, 'core.org.manage');
  const modules = useLoad(() => api<ModuleStatus[]>('/v1/core/modules'));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Switching off is confirmed in place (ConfirmButton), not with a browser pop-up.
  async function toggle(m: ModuleStatus) {
    setBusy(m.key);
    setError(null);
    try {
      await api(`/v1/core/modules/${m.key}/${m.enabled ? 'disable' : 'enable'}`, { method: 'POST' });
      modules.reload();
      reloadSession();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="page">
      <h1>{tr('Apps')}</h1>
      <p className="muted">{trf('Modules enabled for {org}. Disabling a module hides it but keeps its data.', { org: session.org?.name ?? '' })}</p>
      {error && <p className="error">{error}</p>}
      {modules.error && <p className="error">{modules.error}</p>}
      <div className="app-list">
        {modules.data?.map((m) => (
          <div key={m.key} className="app-row">
            <div>
              <div className="app-name">
                {tr(m.name)} <span className="muted small">· {tr(m.suite)}</span>
              </div>
              <div className="muted small">{tr(m.description)}</div>
            </div>
            <span className="spacer" />
            {m.core ? (
              <span className="muted small">{tr('Always on')}</span>
            ) : m.switchOnOnly ? (
              // Accounting: switched on from its own set-up screen (it posts the company's history first) and never switched off.
              m.enabled ? <span className="muted small">{tr('On (cannot be switched off)')}</span> : <Link to="/accounting/setup">{tr('Set up and switch on')}</Link>
            ) : canEdit ? (
              m.enabled
                ? <ConfirmButton label={busy === m.key ? tr('Working…') : tr('Switch off')} confirmLabel={tr('Yes, switch off')} question={trf('Switch off {name}? Its data is kept, but nobody can open it until it\'s switched back on.', { name: tr(m.name) })} disabled={busy === m.key} onConfirm={() => toggle(m)} />
                : <Button disabled={busy === m.key} onClick={() => toggle(m)}>{busy === m.key ? tr('Working…') : tr('Switch on')}</Button>
            ) : (
              <span className="muted small">{m.enabled ? tr('On') : tr('Off')}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
