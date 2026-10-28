import { useState, type FormEvent } from 'react';
import { authLinkError, googleSignInEnabled, supabase, supabaseConfigured } from '../lib/supabase';

export function SignIn() {
  const [mode, setMode] = useState<'sign-in' | 'forgot'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(authLinkError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next: 'sign-in' | 'forgot') {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function signInWithGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) setError(error.message);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === 'sign-in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      // The link brings the user back to this app, which then shows SetPassword.
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) setError(error.message);
      // Same message whether or not the account exists, so the form can't be used to probe emails.
      else setNotice('If an account exists for that email, a reset link is on its way. Check your inbox.');
    }
    setBusy(false);
  }

  return (
    <main className="center">
      <form className="card stack" onSubmit={submit}>
        <h1>{mode === 'sign-in' ? 'Sign in' : 'Reset your password'}</h1>
        {!supabaseConfigured && (
          <p className="error">
            Supabase isn't configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to the .env at the repo root, then
            restart the web app.
          </p>
        )}
        {mode === 'sign-in' && googleSignInEnabled && (
          <>
            <button type="button" className="secondary" onClick={signInWithGoogle}>
              Continue with Google
            </button>
            <div className="divider muted small">or</div>
          </>
        )}
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === 'sign-in' && (
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        {notice && <p className="muted">{notice}</p>}
        <button type="submit" disabled={busy}>
          {mode === 'sign-in' ? (busy ? 'Signing in…' : 'Sign in') : busy ? 'Sending…' : 'Send reset link'}
        </button>
        <button type="button" className="secondary" onClick={() => switchMode(mode === 'sign-in' ? 'forgot' : 'sign-in')}>
          {mode === 'sign-in' ? 'Forgot password?' : 'Back to sign in'}
        </button>
      </form>
    </main>
  );
}
