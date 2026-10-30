import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

// "Set up your company": the second step of sign-up (sql/032). The person is already signed in; this creates the company, makes them
// its owner, switches every app on and stores the company's language, currency and time zone. The language is for the whole
// company: everyone who joins later sees it.

const CURRENCIES = ['EGP', 'SAR', 'AED', 'USD', 'EUR', 'GBP', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD'];

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo';
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
    if (rpcError) return setError(REASONS[rpcError.message] ?? rpcError.message);
    onCreated(data as string);
  }

  return (
    <main className="center">
      <form className="card stack" onSubmit={submit}>
        <h1>{first ? 'Set up your company' : 'Create another company'}</h1>
        <p className="muted small">Takes a minute. You become the owner, and every app is switched on. You can change all of this later in Settings.</p>
        <label>
          Company name
          <input required minLength={2} maxLength={120} autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nile Cosmetics" />
        </label>
        <label>
          Language for the whole company
          <select value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'ar')}>
            <option value="en">English (left to right)</option>
            <option value="ar">العربية: Arabic (right to left)</option>
          </select>
          <span className="hint muted">Everyone in your company will see this language. Arabic is a first draft and covers the menus only so far.</span>
        </label>
        <div className="form-row">
          <label>
            Currency
            <input required list="signup-currencies" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            <datalist id="signup-currencies">{CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label>
            Time zone
            <input required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || name.trim().length < 2}>{busy ? 'Setting up…' : 'Create my company'}</button>
        {onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
        <button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </form>
    </main>
  );
}
