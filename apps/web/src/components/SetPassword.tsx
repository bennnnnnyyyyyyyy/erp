import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

import { tr } from '../lib/i18n';
// Shown after the user follows a password-reset or invite link. Supabase has already signed them in
// with a short-lived recovery session; this sets the new password on that session.
export function SetPassword({ invited = false, onDone }: { invited?: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <main className="center">
      <form className="card stack" onSubmit={submit}>
        <h1>{invited ? tr('Welcome! Choose a password') : tr('Set a new password')}</h1>
        <label>
          {tr('New password')}
          <input
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {tr('Confirm new password')}
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? tr('Saving…') : tr('Save password')}
        </button>
      </form>
    </main>
  );
}
