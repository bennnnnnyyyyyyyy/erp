import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { DATE_FORMATS, hasPermission } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useI18n, type Lang } from '../../lib/i18n';
import { Link, navigate } from '../../lib/router';
import { useReloadSession, useSession } from '../../session';
import { onboardingContent, readProgress, STEP_KEYS, writeProgress, type OnboardingContent } from './onboardingContent';
import {
  canFillSample,
  FILL_STAGES,
  fillApproval,
  fillCompany,
  fillCustomers,
  fillEverything,
  fillItems,
  fillStorage,
  fillSuppliers,
  fillWarehouses,
  type FillStage,
  type OnProgress,
  type Report,
} from './sampleFill';
import { startTour } from './TourHost';

/** "Fill with sample data" is shown only to the accounts named in the build setting DEMO_AUTOFILL_EMAILS (the demo presenter). */
function useCanFill(): boolean {
  const session = useSession();
  return canFillSample(session.email, import.meta.env.VITE_DEMO_AUTOFILL_EMAILS as string | undefined);
}

/** Runs one fill and shows its progress, result and any rows that failed. */
function FillButton({ c, run, onFilled, onNext }: { c: OnboardingContent; run: (onProgress: OnProgress) => Promise<Report>; onFilled?: () => void; onNext?: () => void }) {
  if (!useCanFill()) return null;
  return <FillButtonInner c={c} run={run} onFilled={onFilled} onNext={onNext} />;
}

function FillButtonInner({ c, run, onFilled, onNext }: { c: OnboardingContent; run: (onProgress: OnProgress) => Promise<Report>; onFilled?: () => void; onNext?: () => void }) {
  const [state, setState] = useState<{ busy: boolean; done: number; total: number; report: Report | null; error: string | null }>({
    busy: false,
    done: 0,
    total: 0,
    report: null,
    error: null,
  });
  const go = async () => {
    setState({ busy: true, done: 0, total: 0, report: null, error: null });
    try {
      const report = await run((done, total) => setState((s) => ({ ...s, done, total })));
      setState((s) => ({ ...s, busy: false, report }));
      onFilled?.();
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: (e as Error).message }));
    }
  };
  return (
    <div className="mb-4 rounded-lg border border-dashed border-primary/50 p-3">
      <Button type="button" variant="secondary" onClick={go} disabled={state.busy}>
        {state.busy ? c.fill.working(state.done, state.total || 1) : c.fill.one}
      </Button>
      {state.report ? <p className="m-0 mt-2 text-sm">{c.fill.result(state.report.added, state.report.skipped)}</p> : null}
      <FillFailures c={c} failed={state.report?.failed ?? []} error={state.error} />
      {state.report && onNext ? (
        <Button type="button" className="mt-3" onClick={onNext}>
          {c.next}
        </Button>
      ) : null}
    </div>
  );
}

function FillFailures({ c, failed, error }: { c: OnboardingContent; failed: string[]; error: string | null }) {
  if (!error && failed.length === 0) return null;
  return (
    <div className="error mt-2 text-sm" role="alert">
      {c.fill.failed}
      <ul className="m-0 list-disc ps-5">
        {error ? <li>{error}</li> : null}
        {failed.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  );
}

/** The whole sample company in one go (everything except language and team), stage by stage. */
function FillEverything({ c, onFilled }: { c: OnboardingContent; onFilled: () => void }) {
  const session = useSession();
  const reload = useReloadSession();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<{ stage: FillStage; done: number; total: number } | null>(null);
  const [reports, setReports] = useState<Partial<Record<FillStage, Report>>>({});
  const [error, setError] = useState<string | null>(null);
  const org = session.org;
  if (!org) return null;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await fillEverything(api, org, (s, done, total) => setStage({ stage: s, done, total }));
      setReports(out);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const finished = Object.keys(reports).length > 0;
  return (
    <div className="mt-5 rounded-lg border border-dashed border-primary/50 p-4">
      <p className="m-0 text-sm text-muted-foreground">{c.fill.allHint}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={go} disabled={busy || finished}>
          {busy && stage ? `${c.fill.stages[stage.stage]}: ${c.fill.working(stage.done, stage.total || 1)}` : c.fill.all}
        </Button>
        {finished ? <Button onClick={onFilled}>{c.fill.continueTeam}</Button> : null}
      </div>
      {finished ? (
        <ul className="m-0 mt-3 list-none p-0 text-sm">
          {FILL_STAGES.map((s) => {
            const r = reports[s];
            return r ? (
              <li key={s}>
                ✓ {c.fill.stages[s]}: {c.fill.result(r.added, r.skipped)}
              </li>
            ) : null;
          })}
        </ul>
      ) : null}
      <FillFailures c={c} failed={FILL_STAGES.flatMap((s) => reports[s]?.failed ?? [])} error={error} />
    </div>
  );
}

// First-run setup wizard (documentation/plans/ONBOARDING_WIZARD_PLAN.md). It walks a new owner through welcome, language, company
// details, first warehouse, items, team and approvals, then offers the tour. It only calls API routes that already exist, so it needs no
// database change: every save goes through the same audited database functions as the Settings and Inventory screens. Every step can
// be skipped. Progress is kept in this browser per company (onboardingContent.ts); nothing here is a business record.

const WAREHOUSE_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const TIMEZONES = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Muscat', 'Europe/London', 'UTC'];
const CURRENCIES = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'USD', 'EUR', 'GBP'];

function useList(path: string, enabled: boolean, version: number): { id: string }[] | null {
  const [rows, setRows] = useState<{ id: string }[] | null>(null);
  useEffect(() => {
    if (!enabled) return setRows(null);
    let live = true;
    api<{ id: string }[]>(path)
      .then((r) => live && setRows(Array.isArray(r) ? r : null))
      .catch(() => live && setRows(null));
    return () => {
      live = false;
    };
  }, [path, enabled, version]);
  return rows;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const inputClass = 'h-10 rounded-md border border-border bg-background px-3 text-sm';

export function OnboardingPage() {
  const session = useSession();
  const orgId = session.org?.id ?? 'none';
  const { lang } = useI18n();
  const c = onboardingContent(lang);
  const [step, setStep] = useState(() => readProgress(orgId).step);
  const total = STEP_KEYS.length;
  const key = STEP_KEYS[step] ?? 'welcome';

  const go = (n: number) => {
    const next = Math.max(0, Math.min(total - 1, n));
    setStep(next);
    writeProgress(orgId, { step: next, done: next === total - 1 });
    window.scrollTo?.(0, 0);
  };
  const leave = () => {
    writeProgress(orgId, { step, done: readProgress(orgId).done });
    sessionStorage.setItem(`erp.onboarding.dismissed.${orgId}`, '1');
    navigate('/start');
  };

  const s = c.steps[key];
  return (
    <section className="page">
      <div className="mx-auto max-w-2xl">
        <p className="m-0 text-sm text-muted-foreground">{c.stepOf(step + 1, total)}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step + 1} aria-label={c.stepOf(step + 1, total)}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((step + 1) / total) * 100}%` }} />
        </div>
        <div className="mt-5 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xs">
          <h1 className="m-0 text-xl font-semibold">{s.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          <div className="mt-5">
            {key === 'welcome' && <WelcomeStep c={c} onStart={() => go(1)} onLater={leave} onFilledAll={() => go(STEP_KEYS.indexOf('team'))} />}
            {key === 'language' && <LanguageStep c={c} onDone={() => go(step + 1)} />}
            {key === 'company' && <CompanyStep c={c} onDone={() => go(step + 1)} />}
            {key === 'storage' && <StorageStep c={c} onDone={() => go(step + 1)} />}
            {key === 'warehouse' && <WarehouseStep c={c} onDone={() => go(step + 1)} />}
            {key === 'items' && <ItemsStep c={c} onDone={() => go(step + 1)} />}
            {key === 'suppliers' && <PartyStep c={c} kind="suppliers" onDone={() => go(step + 1)} />}
            {key === 'customers' && <PartyStep c={c} kind="customers" onDone={() => go(step + 1)} />}
            {key === 'team' && <TeamStep c={c} onDone={() => go(step + 1)} />}
            {key === 'approval' && <ApprovalStep c={c} onDone={() => go(step + 1)} />}
            {key === 'done' && <DoneStep c={c} orgId={orgId} />}
          </div>
        </div>
        {key !== 'welcome' && key !== 'done' ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={() => go(step - 1)}>
              {c.back}
            </Button>
            <Button variant="ghost" onClick={() => go(step + 1)}>
              {c.skip}
            </Button>
          </div>
        ) : null}
        {key !== 'done' ? (
          <p className="mt-4 text-center text-xs">
            <button type="button" className="text-muted-foreground underline" onClick={leave}>
              {c.exit}
            </button>
          </p>
        ) : null}
      </div>
    </section>
  );
}

function WelcomeStep({ c, onStart, onLater, onFilledAll }: { c: OnboardingContent; onStart: () => void; onLater: () => void; onFilledAll: () => void }) {
  const canFill = useCanFill();
  return (
    <>
      <ol className="m-0 list-decimal ps-5 text-sm leading-relaxed">
        {c.welcome.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button onClick={onStart}>{c.welcome.start}</Button>
        <Button variant="outline" onClick={onLater}>
          {c.welcome.later}
        </Button>
      </div>
      {canFill ? <FillEverything c={c} onFilled={onFilledAll} /> : null}
    </>
  );
}

function Saver({ c, busy, error, disabled }: { c: OnboardingContent; busy: boolean; error: string | null; disabled?: boolean }) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      {error ? (
        <p className="error m-0" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy || disabled}>
          {busy ? c.saving : c.save}
        </Button>
      </div>
    </div>
  );
}

function useSave(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setBusy(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function LanguageStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const reload = useReloadSession();
  const { lang, setPersonalLang, setOrgLang } = useI18n();
  const canManage = hasPermission(session.permissions, 'core.org.manage');
  const [forCompany, setForCompany] = useState(canManage);
  const { busy, error, run } = useSave(onDone);
  const choose = (l: Lang) => setPersonalLang(l);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (canManage && forCompany && session.org?.language !== lang) {
        await api('/v1/core/org/language', { method: 'POST', body: JSON.stringify({ language: lang }) });
        setOrgLang(lang);
        reload();
      }
    });
  };
  return (
    <form onSubmit={submit}>
      <p className="m-0 text-sm font-medium">{c.language.personal}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Button type="button" variant={lang === 'en' ? 'default' : 'outline'} className="h-12 text-base" lang="en" dir="ltr" onClick={() => choose('en')} aria-pressed={lang === 'en'}>
          English
        </Button>
        <Button type="button" variant={lang === 'ar' ? 'default' : 'outline'} className="h-12 text-base" lang="ar" dir="rtl" onClick={() => choose('ar')} aria-pressed={lang === 'ar'}>
          العربية
        </Button>
      </div>
      {canManage ? (
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={forCompany} onChange={(e) => setForCompany(e.target.checked)} />
          <span>
            {c.language.company}
            <span className="block text-xs text-muted-foreground">{c.language.companyHint}</span>
          </span>
        </label>
      ) : null}
      <Saver c={c} busy={busy} error={error} />
    </form>
  );
}

function CompanyStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const reload = useReloadSession();
  const canManage = hasPermission(session.permissions, 'core.org.manage');
  const org = session.org;
  const [name, setName] = useState(org?.name ?? '');
  const [currency, setCurrency] = useState(org?.defaultCurrency ?? 'EGP');
  const [timezone, setTimezone] = useState(org?.timezone ?? 'Africa/Cairo');
  const [dateFormat, setDateFormat] = useState(org?.dateFormat ?? 'DD/MM/YYYY');
  const { busy, error, run } = useSave(onDone);
  if (!canManage) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const changes: Record<string, string> = {};
      if (name.trim() !== org?.name) changes.name = name.trim();
      if (currency !== org?.defaultCurrency) changes.defaultCurrency = currency;
      if (timezone !== org?.timezone) changes.timezone = timezone;
      if (dateFormat !== org?.dateFormat) changes.dateFormat = dateFormat;
      if (Object.keys(changes).length > 0) {
        await api('/v1/core/org', { method: 'PATCH', body: JSON.stringify(changes) });
        reload();
      }
    });
  };
  const zones = TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES];
  return (
    <>
    {org ? <FillButton c={c} run={() => fillCompany(api, org)} onFilled={reload} onNext={onDone} /> : null}
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label={c.company.name}>
          <input className={inputClass} required minLength={2} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
        </Field>
      </div>
      <Field label={c.company.currency}>
        <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </Field>
      <Field label={c.company.timezone}>
        <select className={inputClass} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </Field>
      <Field label={c.company.dateFormat}>
        <select className={inputClass} value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Saver c={c} busy={busy} error={error} disabled={name.trim().length < 2} />
      </div>
    </form>
    </>
  );
}

function WarehouseStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'inventory.warehouses.manage');
  const existing = useList('/v1/inventory/warehouses', hasPermission(session.permissions, 'inventory.items.read'), 0);
  const [code, setCode] = useState('MAIN');
  const [name, setName] = useState('');
  const { busy, error, run } = useSave(onDone);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/v1/inventory/warehouses', { method: 'POST', body: JSON.stringify({ code: code.trim().toUpperCase(), name: name.trim() }) });
    });
  };
  return (
    <>
    <FillButton
      c={c}
      run={async (p) => {
        const s = await fillStorage(api);
        return (await fillWarehouses(api, s.ids, p)).report;
      }}
      onNext={onDone}
    />
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {existing && existing.length > 0 ? <p className="m-0 text-sm sm:col-span-2">{c.warehouse.existing(existing.length)}</p> : null}
      <Field label={c.warehouse.code} hint={c.warehouse.codeHint}>
        <input className={inputClass} required value={code} onChange={(e) => setCode(e.target.value)} maxLength={32} />
      </Field>
      <Field label={c.warehouse.name}>
        <input className={inputClass} required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <Saver c={c} busy={busy} error={error} disabled={!WAREHOUSE_CODE.test(code.trim()) || name.trim().length === 0} />
      </div>
    </form>
    </>
  );
}

type ItemRow = { sku: string; name: string; unit: string; qty: string };
const emptyRow = (): ItemRow => ({ sku: '', name: '', unit: 'piece', qty: '' });

function ItemsStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'inventory.items.manage');
  const readable = hasPermission(session.permissions, 'inventory.items.read');
  const warehouses = useList('/v1/inventory/warehouses', readable, 0);
  const items = useList('/v1/inventory/items', readable, 0);
  const [rows, setRows] = useState<ItemRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const { busy, error, run } = useSave(onDone);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const warehouseId = warehouses?.[0]?.id ?? null;
  const filled = rows.filter((r) => r.sku.trim() && r.name.trim());
  const set = (i: number, patch: Partial<ItemRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      for (const r of filled) {
        const qty = Number(r.qty || 0);
        await api('/v1/inventory/items', {
          method: 'POST',
          body: JSON.stringify({ sku: r.sku.trim(), name: r.name.trim(), uom: r.unit.trim() || 'piece', openingQty: Number.isFinite(qty) && qty > 0 ? qty : 0, warehouseId: qty > 0 ? warehouseId : null }),
        });
      }
    });
  };
  const needsWarehouse = !warehouseId && filled.some((r) => Number(r.qty) > 0);
  return (
    <>
    <FillButton
      c={c}
      run={async (p) => {
        const s = await fillStorage(api);
        const w = await fillWarehouses(api, s.ids);
        return fillItems(api, w.ids, s.ids, p);
      }}
      onNext={onDone}
    />
    <form onSubmit={submit}>
      {items && items.length > 0 ? <p className="m-0 mb-3 text-sm">{c.items.existing(items.length)}</p> : null}
      <div className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <div key={i} className={cn('grid gap-2 sm:grid-cols-[1fr_2fr_1fr_1fr]')}>
            <Field label={c.items.sku}>
              <input className={inputClass} maxLength={64} value={r.sku} onChange={(e) => set(i, { sku: e.target.value })} />
            </Field>
            <Field label={c.items.name}>
              <input className={inputClass} maxLength={200} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            </Field>
            <Field label={c.items.unit}>
              <input className={inputClass} maxLength={32} value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} />
            </Field>
            <Field label={c.items.opening}>
              <input className={inputClass} type="number" min={0} step="any" inputMode="decimal" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
            </Field>
          </div>
        ))}
      </div>
      {rows.length < 10 ? (
        <Button type="button" variant="ghost" className="mt-2" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          {c.items.addRow}
        </Button>
      ) : null}
      {needsWarehouse ? <p className="m-0 mt-2 text-sm text-muted-foreground">{c.items.needWarehouse}</p> : null}
      <Saver c={c} busy={busy} error={error} disabled={filled.length === 0 || needsWarehouse} />
    </form>
    </>
  );
}

function TeamStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'core.users.manage');
  const [version, setVersion] = useState(0);
  const members = useList('/v1/core/members', hasPermission(session.permissions, 'core.users.read'), version);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/v1/core/members', { method: 'POST', body: JSON.stringify({ email: email.trim(), role, name: fullName.trim() }) });
      setSent((s) => [...s, email.trim()]);
      setEmail('');
      setFullName('');
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  return (
    <form onSubmit={invite} className="grid gap-4 sm:grid-cols-2">
      {members ? <p className="m-0 text-sm sm:col-span-2">{c.team.existing(members.length)}</p> : null}
      <Field label={c.team.email}>
        <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
      </Field>
      <Field label={c.team.fullName}>
        <input className={inputClass} required maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />
      </Field>
      <Field label={c.team.role}>
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {(['admin', 'member', 'viewer'] as const).map((r) => (
            <option key={r} value={r}>
              {c.team.roles[r]}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="outline" disabled={busy || !email.trim() || !fullName.trim()}>
          {busy ? c.saving : c.team.invite}
        </Button>
      </div>
      {error ? (
        <p className="error m-0 sm:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
      {sent.length > 0 ? (
        <ul className="m-0 list-disc ps-5 text-sm sm:col-span-2">
          {sent.map((x) => (
            <li key={x}>{c.team.invited(x)}</li>
          ))}
        </ul>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="button" onClick={onDone}>
          {c.next}
        </Button>
      </div>
    </form>
  );
}

function ApprovalStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'inventory.approval_policies.manage');
  const existing = useList('/v1/inventory/approval-policies', hasPermission(session.permissions, 'inventory.items.read'), 0);
  const [minQty, setMinQty] = useState('100');
  const [approvers, setApprovers] = useState(2);
  const { busy, error, run } = useSave(onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/v1/inventory/approval-policies', {
        method: 'POST',
        body: JSON.stringify({ minTotalQty: Number(minQty), requiredApprovals: approvers, warehouseId: null }),
      });
    });
  };
  return (
    <>
      <p className="m-0 rounded-lg bg-muted p-3 text-sm">{c.approval.always}</p>
      {can ? (
        <div className="mt-4">
          <FillButton c={c} run={() => fillApproval(api)} onNext={onDone} />
        </div>
      ) : null}
      {!can ? (
        <p className="m-0 mt-3 text-sm text-muted-foreground">{c.notAllowed}</p>
      ) : (
        <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
          {existing && existing.length > 0 ? <p className="m-0 text-sm sm:col-span-2">{c.approval.existing(existing.length)}</p> : null}
          <Field label={c.approval.minQty} hint={c.approval.minQtyHint}>
            <input className={inputClass} type="number" min={0} step="any" required value={minQty} onChange={(e) => setMinQty(e.target.value)} />
          </Field>
          <Field label={c.approval.approvers}>
            <select className={inputClass} value={approvers} onChange={(e) => setApprovers(Number(e.target.value))}>
              {[2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Saver c={c} busy={busy} error={error} disabled={!(Number(minQty) >= 0)} />
          </div>
        </form>
      )}
    </>
  );
}

function StorageStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'inventory.batches.manage');
  const existing = useList('/v1/inventory/storage-conditions', hasPermission(session.permissions, 'inventory.batches.read'), 0);
  const [name, setName] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const { busy, error, run } = useSave(onDone);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/v1/inventory/storage-conditions', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), minTempC: min === '' ? null : Number(min), maxTempC: max === '' ? null : Number(max) }),
      });
    });
  };
  return (
    <>
      <FillButton c={c} run={async (p) => (await fillStorage(api, p)).report} onNext={onDone} />
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        {existing && existing.length > 0 ? <p className="m-0 text-sm sm:col-span-3">{c.storage.existing(existing.length)}</p> : null}
        <Field label={c.storage.name}>
          <input className={inputClass} required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={c.storage.min}>
          <input className={inputClass} type="number" step="any" value={min} onChange={(e) => setMin(e.target.value)} />
        </Field>
        <Field label={c.storage.max}>
          <input className={inputClass} type="number" step="any" value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          <Saver c={c} busy={busy} error={error} disabled={name.trim().length === 0} />
        </div>
      </form>
    </>
  );
}

function PartyStep({ c, kind, onDone }: { c: OnboardingContent; kind: 'suppliers' | 'customers'; onDone: () => void }) {
  const session = useSession();
  const path = kind === 'suppliers' ? '/v1/purchasing/suppliers' : '/v1/sales/customers';
  const can = hasPermission(session.permissions, kind === 'suppliers' ? 'purchasing.suppliers.manage' : 'sales.customers.manage');
  const readable = hasPermission(session.permissions, kind === 'suppliers' ? 'purchasing.suppliers.read' : 'sales.customers.read');
  const [version, setVersion] = useState(0);
  const existing = useList(path, readable, version);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [city, setCity] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body: JSON.stringify({ name: name.trim(), contact: contact.trim(), city: city.trim() }) });
      setAdded((a) => [...a, name.trim()]);
      setName('');
      setContact('');
      setCity('');
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  return (
    <>
      <FillButton
        c={c}
        run={(p) => (kind === 'suppliers' ? fillSuppliers(api, p) : fillCustomers(api, p))}
        onFilled={() => setVersion((v) => v + 1)}
        onNext={onDone}
      />
      <form onSubmit={add} className="grid gap-4 sm:grid-cols-3">
        {existing && existing.length > 0 ? <p className="m-0 text-sm sm:col-span-3">{c.party.existing(existing.length)}</p> : null}
        <Field label={c.party.name}>
          <input className={inputClass} required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={c.party.contact}>
          <input className={inputClass} maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <Field label={c.party.city}>
          <input className={inputClass} maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" variant="outline" disabled={busy || name.trim().length === 0}>
            {busy ? c.saving : c.party.add}
          </Button>
          <Button type="button" onClick={onDone}>
            {c.next}
          </Button>
        </div>
        {error ? (
          <p className="error m-0 sm:col-span-3" role="alert">
            {error}
          </p>
        ) : null}
        {added.length > 0 ? (
          <ul className="m-0 list-disc ps-5 text-sm sm:col-span-3">
            {added.map((x) => (
              <li key={x}>{c.party.added(x)}</li>
            ))}
          </ul>
        ) : null}
      </form>
    </>
  );
}

function DoneStep({ c, orgId }: { c: OnboardingContent; orgId: string }) {
  useEffect(() => {
    writeProgress(orgId, { step: STEP_KEYS.length - 1, done: true });
  }, [orgId]);
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        onClick={() => {
          navigate('/');
          startTour();
        }}
      >
        {c.done.tour}
      </Button>
      <Button variant="outline" onClick={() => navigate('/')}>
        {c.done.home}
      </Button>
      <Link to="/start" className="self-center text-sm">
        {c.done.checklist}
      </Link>
    </div>
  );
}
