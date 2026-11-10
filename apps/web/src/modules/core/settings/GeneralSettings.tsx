import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/Loading';
import { DATE_FORMATS, hasPermission, type OrgSettings, type OrgSettingsUpdate } from '@erp/shared';
import { api } from '../../../lib/api';
import { demoMode } from '../../../lib/demo';
import { useI18n, type Lang, tr } from '../../../lib/i18n';
import { useLoad } from '../../../lib/useLoad';
import { useReloadSession, useSession } from '../../../session';
import { CurrencySelect, TimeZoneSelect } from '../../../components/ZoneCurrencyFields';
import { PeriodSettings } from './PeriodSettings';

function OptionRow({ title, line, on, onToggle }: { title: string; line: string; on: boolean; onToggle: () => void }) {
  return (
    <li className="option-row">
      <div>
        <strong>{title}</strong>
        <p className="muted small">{line}</p>
      </div>
      <label className="option-switch">
        <input type="checkbox" role="switch" checked={on} onChange={onToggle} aria-label={title} />
        <span>{on ? tr('On') : tr('Off')}</span>
      </label>
    </li>
  );
}

export function GeneralSettings() {
  const session = useSession();
  const reloadSession = useReloadSession();
  const { t, personalLang, orgLang, setPersonalLang } = useI18n();
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
  if (!form || !org.data) return <Loading />;

  const original = org.data;
  const changes: OrgSettingsUpdate = {};
  if (form.name !== original.name) changes.name = form.name;
  if (form.defaultCurrency !== original.defaultCurrency) changes.defaultCurrency = form.defaultCurrency;
  if (form.timezone !== original.timezone) changes.timezone = form.timezone;
  if (form.dateFormat !== original.dateFormat) changes.dateFormat = form.dateFormat;
  const languageChanged = form.language !== original.language;
  const dirty = Object.keys(changes).length > 0 || languageChanged;

  function set<K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let updated = org.data!;
      if (Object.keys(changes).length > 0) updated = await api<OrgSettings>('/v1/core/org', { method: 'PATCH', body: JSON.stringify(changes) });
      if (languageChanged) {
        await api('/v1/core/org/language', { method: 'POST', body: JSON.stringify({ language: form!.language }) });
        updated = { ...updated, language: form!.language };
      }
      org.setData(updated);
      setSaved(true);
      reloadSession();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function flip(path: string, body: Record<string, boolean>) {
    setError(null);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      reloadSession();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="page">
      <h1>{tr('General')}</h1>
      <p className="muted">{tr('Company profile and system-wide defaults.')}</p>
      <div className="form-card stack">
        <h2>{tr('Your language')}</h2>
        <label>
          {t('My language')}
          <select
            value={personalLang ?? ''}
            onChange={(e) => setPersonalLang(e.target.value === '' ? null : (e.target.value as Lang))}
          >
            <option value="">
              {t('Company default')} ({orgLang === 'ar' ? 'العربية' : 'English'})
            </option>
            <option value="en">{t('English (left to right)')}</option>
            <option value="ar">{t('Arabic (right to left)')}</option>
          </select>
          <span className="hint muted">{tr('Only for you, on every device you sign in on.')}</span>
        </label>
      </div>
      <form className="form-card stack" onSubmit={save}>
        <h2>{tr('Company')}</h2>
        <fieldset disabled={!canEdit || saving} className="stack">
          <label>
            {tr('Organization name')}
            <input required maxLength={200} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <div className="form-row">
            <label>
              {tr('Default currency')}
              <CurrencySelect value={form.defaultCurrency} onChange={(v) => set('defaultCurrency', v)} />
            </label>
            <label>
              {tr('Date format')}
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
            {tr('Default language for the company')}
            <select value={form.language} onChange={(e) => set('language', e.target.value as OrgSettings['language'])}>
              <option value="en">{tr('English (left to right)')}</option>
              <option value="ar">{tr('Arabic (right to left)')}</option>
            </select>
            <span className="hint muted">{tr('What everyone sees until they choose their own language.')}</span>
          </label>
          <label>
            {tr('Time zone')}
            <TimeZoneSelect value={form.timezone} onChange={(v) => set('timezone', v)} />
            <span className="hint muted">{tr('Dates and times across the app are shown in this zone.')}</span>
          </label>
        </fieldset>
        {error && <p className="error">{error}</p>}
        {canEdit ? (
          <div className="form-actions">
            <Button type="submit" disabled={!dirty || saving}>
              {saving ? tr('Saving…') : tr('Save changes')}
            </Button>
            {dirty && (
              <Button variant="outline" type="button" onClick={() => setForm(original)} disabled={saving}>
                {tr('Discard')}
              </Button>
            )}
            {saved && !dirty && <span className="muted">{tr('Saved.')}</span>}
          </div>
        ) : (
          <p className="muted small">{tr('Only owners and admins can change these settings.')}</p>
        )}
      </form>
      {canEdit && !demoMode && (
        <div className="form-card stack">
          <h2>{tr('Company options')}</h2>
          <p className="muted small">{tr('Switches for how the whole company works. Each one can be changed at any time.')}</p>
          <ul className="option-list">
            <OptionRow
              title={tr('Getting-started guide')}
              on={!!session.org?.showTutorial}
              line={tr('A short tutorial for new companies, shown as the "Getting started" app.')}
              onToggle={() => flip('/v1/core/org/tutorial', { show: !session.org?.showTutorial })}
            />
            {session.modules.includes('inventory') && (
              <OptionRow
                title={tr('Blind stock counts')}
                on={!!session.org?.blindCounts}
                line={tr('Staff count what is on the shelf without seeing what the books expect. Owners and admins see it when approving.')}
                onToggle={() => flip('/v1/core/org/blind-counts', { on: !session.org?.blindCounts })}
              />
            )}
            <OptionRow
              title={tr('Guided tour for new staff')}
              on={!!session.org?.showTour}
              line={tr('People new to the company get a short tour of the screens the first time they sign in.')}
              onToggle={() => flip('/v1/core/org/tour', { show: !session.org?.showTour })}
            />
          </ul>
        </div>
      )}
      {canEdit && !demoMode && org.data ? <PeriodSettings org={org.data} onSaved={org.reload} /> : null}
    </section>
  );
}
