import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { BRAND } from '../lib/brand';
import { tr, trf } from '../lib/i18n';
import { useLabChoice } from '../lib/labChoice';
import { timeZoneList } from '../lib/zonesCurrencies';
import { CurrencySelect, TimeZoneSelect } from './ZoneCurrencyFields';
import './createco.css';

// "Set up your company": the second step of sign-up (sql/032). The person is already signed in; this creates the company, makes them
// its owner, switches every app on and stores the company's language, currency and time zone. The language is for the whole company.
// New UI (brief v2, plan of 23 Nov 2026): three versions being decided by Ben and Grant, switched in the Design Lab
// ("Screens being decided > Create company"). They share the logic below; only the layout and flow differ.
//   A  Wizard (Dynamics 365 set-up wizard): steps at the side, defaults filled in, a review step, then Create.
//   B  One question at a time (like the chosen sign in): one big question per page.
//   C  One page with a live preview: the fields beside a preview of how documents, money and dates will look.

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
const VERSIONS = ['A', 'B', 'C'] as const;
type Props = { onCreated: (orgId: string) => void; onCancel?: () => void; first: boolean };

function useCompanyForm(onCreated: (id: string) => void) {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [currency, setCurrency] = useState('EGP');
  const [timezone, setTimezone] = useState(browserTimeZone());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOk = name.trim().length >= 2;
  async function create() {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('core_create_organization', { p_name: name.trim(), p_language: language, p_currency: currency, p_timezone: timezone });
    setBusy(false);
    if (rpcError) return setError(tr(REASONS[rpcError.message] ?? rpcError.message));
    onCreated(data as string);
  }
  return { name, setName, language, setLanguage, currency, setCurrency, timezone, setTimezone, error, busy, nameOk, create };
}
type Form = ReturnType<typeof useCompanyForm>;

const LANGS: { value: 'en' | 'ar'; label: string; note: string }[] = [
  { value: 'ar', label: 'العربية', note: 'Arabic, right to left' },
  { value: 'en', label: 'English', note: 'English, left to right' },
];

function Top({ onCancel }: { onCancel?: () => void }) {
  return (
    <header className="cc-top">
      <span className="cc-logo">
        <img src={BRAND.logo} alt={BRAND.name} />
        <span aria-hidden="true">{BRAND.suffix}</span>
      </span>
      <span className="cc-top-end">
        {onCancel && <button type="button" className="cc-link" onClick={onCancel}>{tr('Cancel')}</button>}
        <button type="button" className="cc-link" onClick={() => supabase.auth.signOut()}>{tr('Sign out')}</button>
      </span>
    </header>
  );
}

function LanguageCards({ f }: { f: Form }) {
  return (
    <div className="cc-cards" role="radiogroup" aria-label={tr('Language for the whole company')}>
      {LANGS.map((l) => (
        <button key={l.value} type="button" role="radio" aria-checked={f.language === l.value} className="cc-card" onClick={() => f.setLanguage(l.value)}>
          <span className="cc-card-big" lang={l.value}>{l.label}</span>
          <span className="cc-card-note">{tr(l.note)}</span>
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="cc-field">
      <span className="cc-label">{label}</span>
      {children}
      {hint && <span className="cc-hint">{hint}</span>}
    </label>
  );
}

function Review({ f }: { f: Form }) {
  const rows: [string, string][] = [
    [tr('Company name'), f.name.trim() || '—'],
    [tr('Language'), f.language === 'ar' ? 'العربية' : 'English'],
    [tr('Currency'), f.currency],
    [tr('Time zone'), f.timezone],
  ];
  return (
    <dl className="cc-review">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd><bdi>{v}</bdi></dd></div>
      ))}
    </dl>
  );
}

const Err = ({ f }: { f: Form }) => (f.error ? <p className="cc-error" role="alert">{f.error}</p> : null);

/* ---------------- A: Wizard ---------------- */
function VersionA({ f, onCancel, first }: { f: Form } & Omit<Props, 'onCreated'>) {
  const STEPS = [tr('Company name'), tr('Money and time'), tr('Language'), tr('Review')];
  const [step, setStep] = useState(0);
  const canNext = step !== 0 || f.nameOk;
  const next = (e: FormEvent) => {
    e.preventDefault();
    if (!canNext) return;
    if (step < STEPS.length - 1) setStep(step + 1);
    else void f.create();
  };
  return (
    <main className="cc cc-a">
      <Top onCancel={onCancel} />
      <form className="cc-a-box" onSubmit={next}>
        <div className="cc-a-head">
          <h1>{first ? tr('Set up your company') : tr('Create another company')}</h1>
          <p className="cc-sub">{tr('You become the owner and every module is enabled. All of this can be changed later in Settings.')}</p>
        </div>
        <ol className="cc-a-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="cc-a-dot" aria-hidden="true">{i < step ? '✓' : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <section className="cc-a-body">
          {step === 0 && (
            <Field label={tr('Company name')} hint={tr('As it should appear on invoices.')}>
              <input autoFocus required minLength={2} maxLength={120} autoComplete="organization" aria-invalid={!f.nameOk && f.name !== ''} value={f.name} onChange={(e) => f.setName(e.target.value)} placeholder={tr('e.g. Nile Cosmetics')} />
            </Field>
          )}
          {step === 1 && (
            <>
              <p className="cc-note">{tr('Filled in for Egypt. Change them if your company works in another currency or time zone.')}</p>
              <div className="cc-two">
                <Field label={tr('Currency')}><CurrencySelect value={f.currency} onChange={f.setCurrency} /></Field>
                <Field label={tr('Time zone')}><TimeZoneSelect value={f.timezone} onChange={f.setTimezone} /></Field>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <p className="cc-note">{tr('This is the default language for your company; each person can pick their own under Settings.')}</p>
              <LanguageCards f={f} />
            </>
          )}
          {step === 3 && (
            <>
              <p className="cc-note">{tr('This company will be created. You can change everything later in Settings.')}</p>
              <Review f={f} />
            </>
          )}
          <Err f={f} />
        </section>
        <footer className="cc-a-foot">
          <button type="button" className="cc-btn cc-btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>{tr('Back')}</button>
          <button type="submit" className="cc-btn cc-btn-primary" disabled={!canNext || f.busy}>
            {step < STEPS.length - 1 ? tr('Next') : f.busy ? tr('Setting up…') : tr('Create my company')}
          </button>
        </footer>
      </form>
    </main>
  );
}

/* ---------------- B: One question at a time ---------------- */
function VersionB({ f, onCancel }: { f: Form } & Omit<Props, 'onCreated'>) {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === 0) ref.current?.focus();
  }, [step]);
  const total = 3;
  const next = (e: FormEvent) => {
    e.preventDefault();
    if (step === 0 && !f.nameOk) return;
    if (step < total - 1) setStep(step + 1);
    else void f.create();
  };
  return (
    <main className="cc cc-b">
      <Top onCancel={onCancel} />
      <form className="cc-b-stage" onSubmit={next} key={step}>
        <p className="cc-b-step">{trf('Step {n} of {total}', { n: step + 1, total })}</p>
        {step === 0 && (
          <>
            <h1>{tr('What is your company called?')}</h1>
            <input ref={ref} className="cc-b-big" required minLength={2} maxLength={120} autoComplete="organization" aria-label={tr('Company name')} placeholder={tr('e.g. Nile Cosmetics')} value={f.name} onChange={(e) => f.setName(e.target.value)} />
          </>
        )}
        {step === 1 && (
          <>
            <h1>{tr('Which language should your company use?')}</h1>
            <LanguageCards f={f} />
          </>
        )}
        {step === 2 && (
          <>
            <h1>{tr('Money and time: is this right?')}</h1>
            <div className="cc-two cc-b-two">
              <Field label={tr('Currency')}><CurrencySelect value={f.currency} onChange={f.setCurrency} /></Field>
              <Field label={tr('Time zone')}><TimeZoneSelect value={f.timezone} onChange={f.setTimezone} /></Field>
            </div>
            <p className="cc-b-who"><bdi>{f.name.trim()}</bdi> · {f.language === 'ar' ? 'العربية' : 'English'}</p>
          </>
        )}
        <Err f={f} />
        <div className="cc-b-actions">
          <button type="submit" className="cc-go" disabled={f.busy || (step === 0 && !f.nameOk)}>
            <span>{step < total - 1 ? tr('Continue') : f.busy ? tr('Setting up…') : tr('Create my company')}</span>
            <span className="cc-arrow" aria-hidden="true">→</span>
          </button>
          {step > 0 && <button type="button" className="cc-link" onClick={() => setStep(step - 1)}>{tr('Back')}</button>}
        </div>
      </form>
    </main>
  );
}

/* ---------------- C: One page with a live preview ---------------- */
function VersionC({ f, onCancel, first }: { f: Form } & Omit<Props, 'onCreated'>) {
  const now = new Date();
  let date = '';
  let time = '';
  let money = '';
  try {
    const loc = f.language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
    date = new Intl.DateTimeFormat(loc, { timeZone: f.timezone, day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    time = new Intl.DateTimeFormat(loc, { timeZone: f.timezone, hour: '2-digit', minute: '2-digit' }).format(now);
    money = new Intl.NumberFormat(loc, { style: 'currency', currency: f.currency }).format(12500);
  } catch {
    /* an unfinished time zone or currency while typing */
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (f.nameOk) void f.create();
  };
  return (
    <main className="cc cc-c">
      <Top onCancel={onCancel} />
      <div className="cc-c-grid">
        <form className="cc-c-form" onSubmit={submit}>
          <h1>{first ? tr('Set up your company') : tr('Create another company')}</h1>
          <p className="cc-sub">{tr('Four things, all filled in except the name. You can change them later in Settings.')}</p>
          <Field label={tr('Company name')}>
            <input autoFocus required minLength={2} maxLength={120} autoComplete="organization" value={f.name} onChange={(e) => f.setName(e.target.value)} placeholder={tr('e.g. Nile Cosmetics')} />
          </Field>
          <Field label={tr('Language for the whole company')}>
            <LanguageCards f={f} />
          </Field>
          <div className="cc-two">
            <Field label={tr('Currency')}><CurrencySelect value={f.currency} onChange={f.setCurrency} /></Field>
            <Field label={tr('Time zone')}><TimeZoneSelect value={f.timezone} onChange={f.setTimezone} /></Field>
          </div>
          <Err f={f} />
          <button type="submit" className="cc-btn cc-btn-primary cc-c-submit" disabled={!f.nameOk || f.busy}>{f.busy ? tr('Setting up…') : tr('Create my company')}</button>
        </form>
        <aside className="cc-c-preview" aria-label={tr('Preview')} dir={f.language === 'ar' ? 'rtl' : 'ltr'} lang={f.language}>
          <p className="cc-c-plabel">{tr('How it will look')}</p>
          <div className="cc-c-doc">
            <div className="cc-c-dochead">
              <strong><bdi>{f.name.trim() || tr('Your company')}</bdi></strong>
              <span>{f.language === 'ar' ? 'فاتورة INV-0001' : 'Invoice INV-0001'}</span>
            </div>
            <div className="cc-c-row"><span>{f.language === 'ar' ? 'التاريخ' : 'Date'}</span><span>{date}</span></div>
            <div className="cc-c-row"><span>{f.language === 'ar' ? 'الوقت' : 'Time'}</span><span>{time}</span></div>
            <div className="cc-c-row cc-c-total"><span>{f.language === 'ar' ? 'الإجمالي' : 'Total'}</span><span>{money}</span></div>
          </div>
          <p className="cc-c-pnote">{tr('Sample figures. Your real invoices use your own settings and logo.')}</p>
        </aside>
      </div>
    </main>
  );
}

export function CreateCompany({ onCreated, onCancel, first }: Props) {
  const f = useCompanyForm(onCreated);
  const version = useLabChoice('createco', VERSIONS, 'A');
  const props = { f, onCancel, first };
  return version === 'B' ? <VersionB {...props} /> : version === 'C' ? <VersionC {...props} /> : <VersionA {...props} />;
}
