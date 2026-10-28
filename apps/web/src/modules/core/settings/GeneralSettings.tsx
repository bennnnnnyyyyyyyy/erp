import { useEffect, useState, type FormEvent } from 'react';
import { DATE_FORMATS, hasPermission, type OrgSettings, type OrgSettingsUpdate } from '@ggo/shared';
import { api } from '../../../lib/api';
import { useLoad } from '../../../lib/useLoad';
import { useReloadSession, useSession } from '../../../session';

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'EGP', 'JOD', 'LBP', 'INR', 'PKR', 'PHP'];

function timeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? [];
}

export function GeneralSettings() {
  const session = useSession();
  const reloadSession = useReloadSession();
  const canEdit = hasPermission(session.permissions, 'core.org.manage');
  const org = useLoad(() => api<OrgSettings>('/v1/core/org'));
  const [form, setForm] = useState<OrgSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (org.data) setForm(org.data);
  }, [org.data]);

  if (org.error) return <p className="error">{org.error}</p>;
  if (!form || !org.data) return <p className="muted">Loading…</p>;

  const original = org.data;
  const changes: OrgSettingsUpdate = {};
  if (form.name !== original.name) changes.name = form.name;
  if (form.defaultCurrency !== original.defaultCurrency) changes.defaultCurrency = form.defaultCurrency;
  if (form.timezone !== original.timezone) changes.timezone = form.timezone;
  if (form.dateFormat !== original.dateFormat) changes.dateFormat = form.dateFormat;
  const dirty = Object.keys(changes).length > 0;

  function set<K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await api<OrgSettings>('/v1/core/org', { method: 'PATCH', body: JSON.stringify(changes) });
      org.setData(updated);
      setSaved(true);
      reloadSession();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page">
      <h1>General</h1>
      <p className="muted">How your organization appears and the defaults every app uses.</p>
      <form className="form-card stack" onSubmit={save}>
        <fieldset disabled={!canEdit || saving} className="stack">
          <label>
            Organization name
            <input required maxLength={200} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <div className="form-row">
            <label>
              Default currency
              <input
                required
                list="currencies"
                maxLength={3}
                value={form.defaultCurrency}
                onChange={(e) => set('defaultCurrency', e.target.value.toUpperCase())}
              />
              <datalist id="currencies">
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label>
              Date format
              <select value={form.dateFormat} onChange={(e) => set('dateFormat', e.target.value as OrgSettings['dateFormat'])}>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Time zone
            <input required list="timezones" value={form.timezone} onChange={(e) => set('timezone', e.target.value)} />
            <datalist id="timezones">
              {timeZones().map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            <span className="hint muted">Dates and times across the app are shown in this zone.</span>
          </label>
        </fieldset>
        {error && <p className="error">{error}</p>}
        {canEdit ? (
          <div className="form-actions">
            <button type="submit" disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {dirty && (
              <button type="button" className="secondary" onClick={() => setForm(original)} disabled={saving}>
                Discard
              </button>
            )}
            {saved && !dirty && <span className="muted">Saved.</span>}
          </div>
        ) : (
          <p className="muted small">Only owners and admins can change these settings.</p>
        )}
      </form>
    </section>
  );
}
