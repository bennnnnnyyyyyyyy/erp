import { useState, type FormEvent } from 'react';
import { DATE_FORMATS, hasPermission } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { useReloadSession, useSession } from '../../session';
import {
  BUSINESS_TYPES,
  onboardingContent,
  readProgress,
  STEP_KEYS,
  stepsFor,
  writeProgress,
  type BusinessType,
  type OnboardingContent,
} from './onboardingContent';
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
import { TIMEZONES, CURRENCIES, inputClass, useCanFill, useList, Field } from './onboardingShared';
import { FillButton, Failures, useSave, useRowsSave, RowsSaver, RowsTable } from './onboardingParts';

// ------------------------------------------------------------------ steps

export function WelcomeStep({ c, onStart, onLater, onFilledAll }: { c: OnboardingContent; onStart: () => void; onLater: () => void; onFilledAll: () => void }) {
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
export function FillEverything({ c, onFilled }: { c: OnboardingContent; onFilled: () => void }) {
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

export function Saver({ c, busy, error, disabled }: { c: OnboardingContent; busy: boolean; error: string | null; disabled?: boolean }) {
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

/** D9: "What do you sell?". One click chooses and moves on; the answer decides which steps follow (stepsFor). */
export function BusinessStep({ c, value, onChoose }: { c: OnboardingContent; value: BusinessType | null; onChoose: (b: BusinessType) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={c.steps.business.title}>
      {BUSINESS_TYPES.map((b) => (
        <button
          key={b}
          type="button"
          aria-pressed={value === b}
          onClick={() => onChoose(b)}
          className={`rounded-lg border p-4 text-start ${value === b ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'}`}
        >
          <span className="block font-medium">{c.business.options[b].label}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{c.business.options[b].hint}</span>
        </button>
      ))}
    </div>
  );
}

export function CompanyStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
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

export function StorageStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
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
      <p className="m-0 mb-2 text-sm text-muted-foreground">{c.storage.skipHint}</p>
      {existing && existing.length > 0 ? <p className="m-0 mb-2 text-sm">{c.storage.existing(existing.length)}</p> : null}
      <RowsTable<SampleCondition>
        cols={[
          { key: 'name', label: c.storage.name },
          { key: 'minTempC', label: c.storage.min, type: 'number', width: '9rem', optional: true },
          { key: 'maxTempC', label: c.storage.max, type: 'number', width: '9rem', optional: true },
        ]}
        rows={rows}
        setRows={setRows}
        blank={blank}
        addLabel={c.items.addRow}
        optionalLabel={c.optional}
      />
      <RowsSaver c={c} s={saver} disabled={filled.length === 0} onSave={() => saver.run((p) => saveConditions(api, filled, p))} />
    </>
  );
}

export function WarehouseStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
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
          { key: 'code', label: c.warehouse.code, width: '9rem' },
          { key: 'name', label: c.warehouse.name },
          { key: 'nameAr', label: `${c.warehouse.name} (ع)`, optional: true },
          { key: 'condition', label: c.warehouse.condition, list: 'onb-conditions', optional: true },
        ]}
        rows={rows}
        setRows={setRows}
        blank={blank}
        addLabel={c.items.addRow}
        optionalLabel={c.optional}
      />
      <p className="m-0 mt-1 text-xs text-muted-foreground">{c.warehouse.conditionHint}</p>
      <RowsSaver c={c} s={saver} disabled={filled.length === 0} onSave={() => saver.run((p) => saveWarehouses(api, filled, p))} />
    </>
  );
}
