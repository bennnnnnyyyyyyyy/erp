import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authLinkError, googleSignInEnabled, supabase, supabaseConfigured } from '../lib/supabase';
import { BRAND } from '../lib/brand';
import { tr, trf, useI18n } from '../lib/i18n';
import { authErrorMessage } from '../lib/authErrors';
import './signin.css';

// Sign in, create an account, reset the password. New UI (Ben's pick, 23 Nov 2026: "B, one step at a time"): a full page with one big
// question per step. Sign in and create an account: email, then password. Reset: email only. No card, no box.

type Mode = 'sign-in' | 'sign-up' | 'forgot';

/** English / العربية. Each name is written in its own language, so it is not translated. Saved on this device until sign-in. */
function LanguageSwitch() {
  const { lang, setPersonalLang } = useI18n();
  return (
    <div className="si-lang" role="group" aria-label={tr('Language')}>
      <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => setPersonalLang('en')}>English</button>
      <button type="button" lang="ar" aria-pressed={lang === 'ar'} onClick={() => setPersonalLang('ar')}>العربية</button>
    </div>
  );
}

export function SignInNew() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(authLinkError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const twoSteps = mode !== 'forgot';
  // Keyboard: the cursor is always in the one box of the step.
  useEffect(() => {
    field.current?.focus();
  }, [step, mode]);

  function switchMode(next: Mode) {
    setMode(next);
    setStep(1);
    setPassword('');
    setAgain('');
    setError(null);
    setNotice(null);
  }

  async function signInWithGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) setError(authErrorMessage(error));
  }

  async function finish() {
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === 'sign-in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(authErrorMessage(error));
    } else if (mode === 'sign-up') {
      if (password.length < 8) setError(tr('Use at least 8 characters for the password.'));
      else if (password !== again) setError(tr('The two passwords are not the same.'));
      else {
        // The confirmation link brings the person back here. If the project does not require confirmation they are signed in at once
        // and go straight to setting up their company; otherwise they confirm first and then sign in.
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) setError(authErrorMessage(error));
        else if (!data.session) {
          // Same message whether or not the address already has an account, so the form can't be used to probe emails.
          setMode('sign-in');
          setStep(1);
          setPassword('');
          setAgain('');
          setNotice(trf('We sent a confirmation link to {email}. Open it, then come back here and sign in to set up your company.', { email }));
        }
      }
    } else {
      // The link brings the user back to this app, which then shows SetPassword.
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) setError(authErrorMessage(error));
      // Same message whether or not the account exists, so the form can't be used to probe emails.
      else setNotice(tr('If an account exists for that email, a reset link is on its way. Check your inbox.'));
    }
    setBusy(false);
  }

  function next(e: FormEvent) {
    e.preventDefault();
    if (step === 1 && twoSteps) {
      setError(null);
      setNotice(null);
      setStep(2);
    } else void finish();
  }

  const question =
    step === 1
      ? mode === 'forgot' ? tr('Which email should get the reset link?') : mode === 'sign-up' ? tr('What is your work email?') : tr('Welcome back. What is your email?')
      : mode === 'sign-up' ? tr('Choose a password') : tr('Your password');
  const action =
    step === 1 && twoSteps ? tr('Continue')
      : mode === 'sign-in' ? (busy ? tr('Signing in…') : tr('Sign in'))
      : mode === 'sign-up' ? (busy ? tr('Creating…') : tr('Create account'))
      : busy ? tr('Sending…') : tr('Send reset link');

  return (
    <main className="si">
      <header className="si-top">
        <span className="si-logo">
          <img src={BRAND.logo} alt={BRAND.name} />
          <span aria-hidden="true">{BRAND.suffix}</span>
        </span>
        <LanguageSwitch />
      </header>

      <form className="si-stage" onSubmit={next}>
        <p className="si-step">{twoSteps ? trf('Step {n} of 2', { n: step }) : tr('Reset your password')}</p>
        <h1>{question}</h1>

        {step === 1 ? (
          <input
            ref={field}
            className="si-big"
            type="email"
            autoComplete="email"
            required
            aria-label={tr('Email')}
            placeholder={tr('name@company.com')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        ) : (
          <>
            <p className="si-who">
              <bdi>{email}</bdi>
              <button type="button" className="si-link" onClick={() => setStep(1)}>{tr('Change')}</button>
            </p>
            <span className="si-pass">
              <input
                ref={field}
                className="si-big"
                type={shown ? 'text' : 'password'}
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'sign-up' ? 8 : undefined}
                aria-label={tr('Password')}
                aria-describedby={mode === 'sign-up' ? 'si-hint' : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="si-eye" onClick={() => setShown((s) => !s)} aria-pressed={shown}>{shown ? tr('Hide') : tr('Show')}</button>
            </span>
            {mode === 'sign-up' && (
              <>
                <span id="si-hint" className="si-hint">{tr('At least 8 characters.')}</span>
                <input
                  className="si-big si-big-2"
                  type={shown ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  aria-label={tr('Repeat the password')}
                  placeholder={tr('Repeat the password')}
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                />
              </>
            )}
          </>
        )}

        {!supabaseConfigured && <p className="si-msg si-msg-error">{tr('Supabase isn\'t configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to the .env at the repo root, then restart the web app.')}</p>}
        {error && <p className="si-msg si-msg-error" role="alert">{error}</p>}
        {notice && <p className="si-msg si-msg-ok" role="status">{notice}</p>}

        <div className="si-actions">
          <button type="submit" className="si-go" disabled={busy}>
            <span>{action}</span>
            <span className="si-arrow" aria-hidden="true">→</span>
          </button>
          {step === 2 && mode === 'sign-in' && <button type="button" className="si-link" onClick={() => switchMode('forgot')}>{tr('Forgot password?')}</button>}
        </div>
      </form>

      <footer className="si-foot">
        {mode === 'sign-in' ? (
          <span>{tr('New here?')} <button type="button" className="si-link" onClick={() => switchMode('sign-up')}>{tr('Create an account')}</button></span>
        ) : (
          <button type="button" className="si-link" onClick={() => switchMode('sign-in')}>{tr('Back to sign in')}</button>
        )}
        {googleSignInEnabled && mode !== 'forgot' && <button type="button" className="si-link" onClick={signInWithGoogle}>{tr('Continue with Google')}</button>}
      </footer>
    </main>
  );
}
