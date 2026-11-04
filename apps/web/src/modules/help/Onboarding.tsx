import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { DATE_FORMATS, hasPermission } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { useI18n, type Lang } from '../../lib/i18n';
import { Link, navigate } from '../../lib/router';
import { useReloadSession, useSession } from '../../session';
import { onboardingContent, readProgress, STEP_KEYS, writeProgress, type OnboardingContent } from './onboardingContent';
import {
  SAMPLE_APPROVAL,
  SAMPLE_COMPANY,
  SAMPLE_CONDITIONS,
  SAMPLE_CUSTOMERS,
  SAMPLE_ITEMS,
  SAMPLE_SUPPLIERS,
  SAMPLE_WAREHOUSES,
  type SampleCondition,
  type SampleItem,
  type SampleParty,
  type SampleWarehouse,
} from './sampleCompany';
import {
  canFillSample,
  FILL_STAGES,
  fillEverything,
  saveConditions,
  saveItems,
  saveParties,
  saveWarehouses,
  type FillStage,
  type OnProgress,
  type Report,
} from './sampleFill';
import { startTour } from './TourHost';

// First-run setup wizard (documentation/plans/ONBOARDING_WIZARD_PLAN.md). Welcome, language, company, storage conditions, warehouses,
// items, suppliers, customers, team, approvals, then the tour. Every save goes through an existing API route (the same audited database
// functions as the normal screens); every step can be skipped. For the demo account only, "Fill with sample data" puts the cosmetics
// sample (sampleCompany.ts) straight into the form on screen, with no animation; the presenter can change anything, then saves.
// Progress is kept in this browser per company (onboardingContent.ts); nothing here is a business record.

const TIMEZONES = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Muscat', 'Europe/London', 'UTC'];
const CURRENCIES = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'USD', 'EUR', 'GBP'];
const inputClass = 'h-10 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm';

/** "Fill with sample data" is shown only to the accounts named in the build setting DEMO_AUTOFILL_EMAILS (the demo presenter). */
function useCanFill(): boolean {
  const session = useSession();
  return canFillSample(session.email, import.meta.env.VITE_DEMO_AUTOFILL_EMAILS as string | undefined);
}

function useList<T extends { id: string }>(path: string, enabled: boolean, version: number): T[] | null {
  const [rows, setRows] = useState<T[] | null>(null);
  useEffect(() => {
    if (!enabled) return setRows(null);
    let live = true;
    api<T[]>(path)
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
  const next = () => go(step + 1);
  const leave = () => {
    writeProgress(orgId, { step, done: readProgress(orgId).done });
    sessionStorage.setItem(`erp.onboarding.dismissed.${orgId}`, '1');
    navigate('/start');
  };

  const s = c.steps[key];
  return (
    <section className="page">
      <div className="mx-auto max-w-4xl">
        <p className="m-0 text-sm text-muted-foreground">{c.stepOf(step + 1, total)}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step + 1} aria-label={c.stepOf(step + 1, total)}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${((step + 1) / total) * 100}%` }} />
        </div>
        <div className="mt-5 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xs">
          <h1 className="m-0 text-xl font-semibold">{s.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          <div className="mt-5">
            {key === 'welcome' && <WelcomeStep c={c} onStart={() => go(1)} onLater={leave} onFilledAll={() => go(STEP_KEYS.indexOf('team'))} />}
            {key === 'language' && <LanguageStep c={c} onDone={next} />}
            {key === 'company' && <CompanyStep c={c} onDone={next} />}
            {key === 'storage' && <StorageStep c={c} onDone={next} />}
            {key === 'warehouse' && <WarehouseStep c={c} onDone={next} />}
            {key === 'items' && <ItemsStep c={c} onDone={next} />}
            {key === 'suppliers' && <PartyStep c={c} kind="suppliers" onDone={next} />}
            {key === 'customers' && <PartyStep c={c} kind="customers" onDone={next} />}
            {key === 'team' && <TeamStep c={c} onDone={next} />}
            {key === 'approval' && <ApprovalStep c={c} onDone={next} />}
            {key === 'done' && <DoneStep c={c} orgId={orgId} />}
          </div>
        </div>
        {key !== 'welcome' && key !== 'done' ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={() => go(step - 1)}>
              {c.back}
            </Button>
            <Button variant="ghost" onClick={next}>
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

// ------------------------------------------------------------------ shared pieces

/** The demo-only button that puts the sample into the form on screen. Nothing is saved until Save. */
function FillButton({ c, onFill }: { c: OnboardingContent; onFill: () => void }) {
  if (!useCanFill()) return null;
  return (
    <div className="mb-4">
      <Button type="button" variant="secondary" onClick={onFill}>
        {c.fill.one}
      </Button>
    </div>
  );
}

function Failures({ c, failed, error }: { c: OnboardingContent; failed: string[]; error: string | null }) {
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

/** Save for a single form: shows "Saving…", the error, and moves on when it worked. */
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

/** Save for a table of rows: progress on the button, the rows that failed, and moves on when every row was saved. */
function useRowsSave(onDone: () => void) {
  const [state, setState] = useState<{ busy: boolean; done: number; total: number; report: Report | null; error: string | null }>({
    busy: false,
    done: 0,
    total: 0,
    report: null,
    error: null,
  });
  const run = async (save: (p: OnProgress) => Promise<Report>) => {
    setState({ busy: true, done: 0, total: 0, report: null, error: null });
    try {
      const report = await save((done, total) => setState((s) => ({ ...s, done, total })));
      setState((s) => ({ ...s, busy: false, report }));
      if (report.failed.length === 0) onDone();
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: (e as Error).message }));
    }
  };
  return { ...state, run };
}

function RowsSaver({ c, s, disabled, onSave }: { c: OnboardingContent; s: ReturnType<typeof useRowsSave>; disabled?: boolean; onSave: () => void }) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      <div>
        <Button type="button" onClick={onSave} disabled={s.busy || disabled}>
          {s.busy ? c.fill.working(s.done, s.total || 1) : c.save}
        </Button>
      </div>
      {s.report ? <p className="m-0 text-sm">{c.fill.result(s.report.added, s.report.skipped)}</p> : null}
      <Failures c={c} failed={s.report?.failed ?? []} error={s.error} />
    </div>
  );
}

type Col<T> = { key: keyof T & string; label: string; type?: 'text' | 'number'; list?: string; width?: string };

/** An editable table: one input per cell, add and remove rows. Logical properties only, so it mirrors in Arabic. */
function RowsTable<T extends Record<string, string | number | null>>({
  cols,
  rows,
  setRows,
  blank,
  addLabel,
}: {
  cols: Col<T>[];
  rows: T[];
  setRows: (r: T[]) => void;
  blank: () => T;
  addLabel: string;
}) {
  const set = (i: number, k: keyof T, v: string) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: cols.find((x) => x.key === k)?.type === 'number' ? (v === '' ? null : Number(v)) : v } : r)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            {cols.map((col) => (
              <th key={col.key} scope="col" className="text-start font-medium" style={col.width ? { width: col.width } : undefined}>
                {col.label}
              </th>
            ))}
            <th scope="col" className="w-8">
              <span className="sr-only">✕</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((col) => (
                <td key={col.key}>
                  <input
                    className={inputClass}
                    aria-label={`${col.label} ${i + 1}`}
                    type={col.type === 'number' ? 'number' : 'text'}
                    step={col.type === 'number' ? 'any' : undefined}
                    list={col.list}
                    value={r[col.key] === null || r[col.key] === undefined ? '' : String(r[col.key])}
                    onChange={(e) => set(i, col.key, e.target.value)}
                  />
                </td>
              ))}
              <td>
                <button type="button" className="h-10 w-8 text-muted-foreground" aria-label={`✕ ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button type="button" variant="ghost" className="mt-1" onClick={() => setRows([...rows, blank()])}>
        {addLabel}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ steps

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

/** The whole sample company saved in one go (everything except language and team), stage by stage. For rehearsals and short demos. */
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
      setReports(await fillEverything(api, org, (s, done, total) => setStage({ stage: s, done, total })));
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
      <Failures c={c} failed={FILL_STAGES.flatMap((s) => reports[s]?.failed ?? [])} error={error} />
    </div>
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
  const fill = () => {
    // The company name stays as typed at sign-up.
    setCurrency(SAMPLE_COMPANY.defaultCurrency);
    setTimezone(SAMPLE_COMPANY.timezone);
    setDateFormat(SAMPLE_COMPANY.dateFormat);
  };
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
      <FillButton c={c} onFill={fill} />
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

function StorageStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'inventory.batches.manage');
  const existing = useList<{ id: string }>('/v1/inventory/storage-conditions', hasPermission(session.permissions, 'inventory.batches.read'), 0);
  const blank = (): SampleCondition => ({ name: '', minTempC: null, maxTempC: null });
  const [rows, setRows] = useState<SampleCondition[]>([blank()]);
  const saver = useRowsSave(onDone);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const filled = rows.filter((r) => r.name.trim());
  return (
    <>
      <FillButton c={c} onFill={() => setRows(SAMPLE_CONDITIONS.map((x) => ({ ...x })))} />
      {existing && existing.length > 0 ? <p className="m-0 mb-2 text-sm">{c.storage.existing(existing.length)}</p> : null}
      <RowsTable<SampleCondition>
        cols={[
          { key: 'name', label: c.storage.name },
          { key: 'minTempC', label: c.storage.min, type: 'number', width: '8rem' },
          { key: 'maxTempC', label: c.storage.max, type: 'number', width: '8rem' },
        ]}
        rows={rows}
        setRows={setRows}
        blank={blank}
        addLabel={c.items.addRow}
      />
      <RowsSaver c={c} s={saver} disabled={filled.length === 0} onSave={() => saver.run((p) => saveConditions(api, filled, p))} />
    </>
  );
}

function WarehouseStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'inventory.warehouses.manage');
  const existing = useList<{ id: string }>('/v1/inventory/warehouses', hasPermission(session.permissions, 'inventory.items.read'), 0);
  const conditions = useList<{ id: string; name: string }>('/v1/inventory/storage-conditions', hasPermission(session.permissions, 'inventory.batches.read'), 0);
  const blank = (): SampleWarehouse => ({ code: '', name: '', nameAr: '', condition: '' });
  const [rows, setRows] = useState<SampleWarehouse[]>([{ ...blank(), code: 'MAIN' }]);
  const saver = useRowsSave(onDone);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const filled = rows.filter((r) => r.code.trim() && r.name.trim());
  return (
    <>
      <FillButton c={c} onFill={() => setRows(SAMPLE_WAREHOUSES.map((x) => ({ ...x })))} />
      {existing && existing.length > 0 ? <p className="m-0 mb-2 text-sm">{c.warehouse.existing(existing.length)}</p> : null}
      <datalist id="onb-conditions">
        {(conditions ?? []).map((x) => (
          <option key={x.id} value={x.name} />
        ))}
      </datalist>
      <RowsTable<SampleWarehouse>
        cols={[
          { key: 'code', label: c.warehouse.code, width: '7rem' },
          { key: 'name', label: c.warehouse.name },
          { key: 'nameAr', label: `${c.warehouse.name} (ع)` },
          { key: 'condition', label: c.steps.storage.title, list: 'onb-conditions' },
        ]}
        rows={rows}
        setRows={setRows}
        blank={blank}
        addLabel={c.items.addRow}
      />
      <RowsSaver c={c} s={saver} disabled={filled.length === 0} onSave={() => saver.run((p) => saveWarehouses(api, filled, p))} />
    </>
  );
}

/** A table row for items: cost is typed in currency units (e.g. 24.00) and kept as minor units on save. */
type ItemRow = Omit<SampleItem, 'costMinor'> & { cost: number | null };
const toItemRow = (x: SampleItem): ItemRow => ({ sku: x.sku, name: x.name, nameAr: x.nameAr, uom: x.uom, warehouse: x.warehouse, condition: x.condition, openingQty: x.openingQty, cost: x.costMinor / 100 });
// Two decimals, as for EGP and most currencies here. (A three-decimal currency such as KWD would need the currency's own exponent.)
const fromItemRow = (r: ItemRow): SampleItem => ({ ...r, openingQty: Number(r.openingQty) || 0, costMinor: Math.round((Number(r.cost) || 0) * 100) });

function ItemsStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'inventory.items.manage');
  const readable = hasPermission(session.permissions, 'inventory.items.read');
  const items = useList<{ id: string }>('/v1/inventory/items', readable, 0);
  const warehouses = useList<{ id: string; code: string }>('/v1/inventory/warehouses', readable, 0);
  const conditions = useList<{ id: string; name: string }>('/v1/inventory/storage-conditions', hasPermission(session.permissions, 'inventory.batches.read'), 0);
  const blank = (): ItemRow => ({ sku: '', name: '', nameAr: '', uom: 'piece', warehouse: warehouses?.[0]?.code ?? '', condition: '', openingQty: 0, cost: null });
  const [rows, setRows] = useState<ItemRow[]>(() => [blank(), blank(), blank()]);
  const saver = useRowsSave(onDone);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const filled = rows.filter((r) => r.sku.trim() && r.name.trim());
  return (
    <>
      <FillButton c={c} onFill={() => setRows(SAMPLE_ITEMS.map(toItemRow))} />
      {items && items.length > 0 ? <p className="m-0 mb-2 text-sm">{c.items.existing(items.length)}</p> : null}
      <datalist id="onb-warehouses">
        {(warehouses ?? []).map((x) => (
          <option key={x.id} value={x.code} />
        ))}
      </datalist>
      <datalist id="onb-item-conditions">
        {(conditions ?? []).map((x) => (
          <option key={x.id} value={x.name} />
        ))}
      </datalist>
      <RowsTable<ItemRow>
        cols={[
          { key: 'sku', label: c.items.sku, width: '7rem' },
          { key: 'name', label: c.items.name },
          { key: 'uom', label: c.items.unit, width: '5rem' },
          { key: 'warehouse', label: c.warehouse.code, list: 'onb-warehouses', width: '6rem' },
          { key: 'openingQty', label: c.items.opening, type: 'number', width: '6rem' },
          { key: 'cost', label: c.items.cost, type: 'number', width: '6rem' },
          { key: 'condition', label: c.steps.storage.title, list: 'onb-item-conditions', width: '8rem' },
        ]}
        rows={rows}
        setRows={setRows}
        blank={blank}
        addLabel={c.items.addRow}
      />
      <RowsSaver c={c} s={saver} disabled={filled.length === 0} onSave={() => saver.run((p) => saveItems(api, filled.map(fromItemRow), p))} />
    </>
  );
}

function PartyStep({ c, kind, onDone }: { c: OnboardingContent; kind: 'suppliers' | 'customers'; onDone: () => void }) {
  const session = useSession();
  const path = kind === 'suppliers' ? '/v1/purchasing/suppliers' : '/v1/sales/customers';
  const can = hasPermission(session.permissions, kind === 'suppliers' ? 'purchasing.suppliers.manage' : 'sales.customers.manage');
  const readable = hasPermission(session.permissions, kind === 'suppliers' ? 'purchasing.suppliers.read' : 'sales.customers.read');
  const existing = useList<{ id: string }>(path, readable, 0);
  const blank = (): SampleParty => ({ name: '', contact: '', city: '' });
  const [rows, setRows] = useState<SampleParty[]>([blank()]);
  const saver = useRowsSave(onDone);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const filled = rows.filter((r) => r.name.trim());
  const sample = kind === 'suppliers' ? SAMPLE_SUPPLIERS : SAMPLE_CUSTOMERS;
  return (
    <>
      <FillButton c={c} onFill={() => setRows(sample.map((x) => ({ ...x })))} />
      {existing && existing.length > 0 ? <p className="m-0 mb-2 text-sm">{c.party.existing(existing.length)}</p> : null}
      <RowsTable<SampleParty>
        cols={[
          { key: 'name', label: c.party.name },
          { key: 'contact', label: c.party.contact },
          { key: 'city', label: c.party.city, width: '9rem' },
        ]}
        rows={rows}
        setRows={setRows}
        blank={blank}
        addLabel={c.items.addRow}
      />
      <RowsSaver c={c} s={saver} disabled={filled.length === 0} onSave={() => saver.run((p) => saveParties(api, path, filled, p))} />
    </>
  );
}

function TeamStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'core.users.manage');
  const [version, setVersion] = useState(0);
  const members = useList<{ id: string }>('/v1/core/members', hasPermission(session.permissions, 'core.users.read'), version);
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
  const existing = useList<{ id: string }>('/v1/inventory/approval-policies', hasPermission(session.permissions, 'inventory.items.read'), 0);
  const [minQty, setMinQty] = useState('');
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
      {!can ? (
        <p className="m-0 mt-3 text-sm text-muted-foreground">{c.notAllowed}</p>
      ) : (
        <div className="mt-4">
          <FillButton
            c={c}
            onFill={() => {
              setMinQty(String(SAMPLE_APPROVAL.minTotalQty));
              setApprovers(SAMPLE_APPROVAL.requiredApprovals);
            }}
          />
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
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
              <Saver c={c} busy={busy} error={error} disabled={minQty === '' || !(Number(minQty) >= 0)} />
            </div>
          </form>
        </div>
      )}
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
