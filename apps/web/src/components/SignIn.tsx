import { useState, type FormEvent } from 'react';
import { authLinkError, googleSignInEnabled, supabase, supabaseConfigured } from '../lib/supabase';

type Mode = 'sign-in' | 'sign-up' | 'forgot';
const TITLE: Record<Mode, string> = { 'sign-in': 'Sign in', 'sign-up': 'Create your account', forgot: 'Reset your password' };

export function SignIn() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(authLinkError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
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
    setNotice(null);
    if (mode === 'sign-in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else if (mode === 'sign-up') {
      if (password.length < 8) setError('Use at least 8 characters for the password.');
      else if (password !== again) setError('The two passwords are not the same.');
      else {
        // The confirmation link brings the person back here. If the project does not require confirmation they are signed in at once
        // and go straight to setting up their company; otherwise they confirm first and then sign in.
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) setError(error.message);
        else if (!data.session) {
          // Same message whether or not the address already has an account, so the form can't be used to probe emails.
          setNotice(`We sent a confirmation link to ${email}. Open it, then come back here and sign in to set up your company.`);
          setMode('sign-in');
          setPassword('');
          setAgain('');
        }
      }
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
        <h1>{TITLE[mode]}</h1>
        {mode === 'sign-up' && <p className="muted small">Start with your own login. Next you will set up your company, which takes about a minute.</p>}
        {!supabaseConfigured && (
          <p className="error">
            Supabase isn't configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to the .env at the repo root, then
            restart the web app.
          </p>
        )}
        {mode !== 'forgot' && googleSignInEnabled && (
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
        {mode !== 'forgot' && (
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              required
              minLength={mode === 'sign-up' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'sign-up' && <span className="hint muted">At least 8 characters.</span>}
          </label>
        )}
        {mode === 'sign-up' && (
          <label>
            Repeat the password
            <input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        <button type="submit" disabled={busy}>
          {mode === 'sign-in' ? (busy ? 'Signing in…' : 'Sign in') : mode === 'sign-up' ? (busy ? 'Creating…' : 'Create account') : busy ? 'Sending…' : 'Send reset link'}
        </button>
        {mode === 'sign-in' && (
          <>
            <button type="button" className="secondary" onClick={() => switchMode('sign-up')}>New here? Create an account</button>
            <button type="button" className="secondary" onClick={() => switchMode('forgot')}>Forgot password?</button>
          </>
        )}
        {mode !== 'sign-in' && (
          <button type="button" className="secondary" onClick={() => switchMode('sign-in')}>Back to sign in</button>
        )}
      </form>
    </main>
  );
}
