import { useState } from 'react';
import { hasPermission, type ModuleStatus } from '@ggo/shared';
import { api } from '../../../lib/api';
import { useLoad } from '../../../lib/useLoad';
import { useReloadSession, useSession } from '../../../session';

// Switch modules on or off for the organization. Data is kept when a module is switched off.
export function AppsSettings() {
  const session = useSession();
  const reloadSession = useReloadSession();
  const canEdit = hasPermission(session.permissions, 'core.org.manage');
  const modules = useLoad(() => api<ModuleStatus[]>('/v1/core/modules'));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(m: ModuleStatus) {
    if (m.enabled && !window.confirm(`Switch off ${m.name}? Its data is kept, but nobody can open it until it's switched back on.`)) return;
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
      <h1>Apps</h1>
      <p className="muted">Choose which apps {session.org?.name} uses. Switching one off hides it but keeps its data.</p>
      {error && <p className="error">{error}</p>}
      {modules.error && <p className="error">{modules.error}</p>}
      <div className="app-list">
        {modules.data?.map((m) => (
          <div key={m.key} className="app-row">
            <div>
              <div className="app-name">
                {m.name} <span className="muted small">· {m.suite}</span>
              </div>
              <div className="muted small">{m.description}</div>
            </div>
            <span className="spacer" />
            {m.core ? (
              <span className="muted small">Always on</span>
            ) : canEdit ? (
              <button className={m.enabled ? 'secondary' : undefined} disabled={busy === m.key} onClick={() => toggle(m)}>
                {busy === m.key ? 'Working…' : m.enabled ? 'Switch off' : 'Switch on'}
              </button>
            ) : (
              <span className="muted small">{m.enabled ? 'On' : 'Off'}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
