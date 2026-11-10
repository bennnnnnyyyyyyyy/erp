import { useState, type FormEvent } from 'react';
import { Button } from './ui/button';
import { supabase } from '../lib/supabase';

import { tr } from '../lib/i18n';
import { timeZoneList } from '../lib/zonesCurrencies';
import { CurrencySelect, TimeZoneSelect } from './ZoneCurrencyFields';
import { ErrorToast } from './Toast';
// "Set up your company": the second step of sign-up (sql/032). The person is already signed in; this creates the company, makes them
// its owner, switches every app on and stores the company's language, currency and time zone. The language is for the whole
// company: everyone who joins later sees it.

function browserTimeZone(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return z && timeZoneList().includes(z) ? z : 'Africa/Cairo';
  } catch {
    return 'Africa/Cairo';
  }
}

const REASONS: Record<string, string> = {
  EMAIL_NOT_CONFIRMED: 'Please confirm your email first: open the link we sent you, then come back and sign in.',
  LIMIT_REACHED: 'You already own three companies. Ask us if you need more.',
  INVALID_INPUT: 'Please check the company name (at least 2 letters), currency and time zone.',
  NOT_SIGNED_IN: 'Please sign in again.',
};

export function CreateCompany({ onCreated, onCancel, first }: { onCreated: (orgId: string) => void; onCancel?: () => void; first: boolean }) {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [currency, setCurrency] = useState('EGP');
  const [timezone, setTimezone] = useState(browserTimeZone());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('core_create_organization', { p_name: name, p_language: language, p_currency: currency, p_timezone: timezone });
    setBusy(false);
    if (rpcError) return setError(tr(REASONS[rpcError.message] ?? rpcError.message));
    onCreated(data as string);
  }

  return (
    <main className="center">
      <form className="card stack" onSubmit={submit}>
        <h1>{first ? tr('Set up your company') : tr('Create another company')}</h1>
        <p className="muted small">{tr('You become the owner and every module is enabled. All of this can be changed later in Settings.')}</p>
        <label>
          {tr('Company name')}
          <input required minLength={2} maxLength={120} autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Nile Cosmetics')} />
        </label>
        <label>
          {tr('Language for the whole company')}
          <select value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'ar')}>
            <option value="en">{tr('English (left to right)')}</option>
            <option value="ar">العربية: Arabic (right to left)</option>
          </select>
          <span className="hint muted">{tr('This is the default language for your company; each person can pick their own under Settings. Arabic is a first draft that a native speaker still has to review.')}</span>
        </label>
        <div className="form-row">
          <label>
            {tr('Currency')}
            <CurrencySelect value={currency} onChange={setCurrency} />
          </label>
          <label>
            {tr('Time zone')}
            <TimeZoneSelect value={timezone} onChange={setTimezone} />
          </label>
        </div>
        <ErrorToast message={error} onClose={() => setError(null)} />
        <Button type="submit" disabled={busy || name.trim().length < 2}>{busy ? tr('Setting up…') : tr('Create my company')}</Button>
        {onCancel && <Button variant="outline" type="button" onClick={onCancel}>{tr('Cancel')}</Button>}
        <Button variant="outline" type="button" onClick={() => supabase.auth.signOut()}>{tr('Sign out')}</Button>
      </form>
    </main>
  );
}
