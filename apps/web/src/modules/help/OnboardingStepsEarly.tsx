import { useState, type FormEvent } from 'react';
import { DATE_FORMATS, hasPermission } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { tr } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { EditWarehouseModal } from '../inventory/ItemModals';
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
import { inputClass, useCanFill, useList, Field } from './onboardingShared';
import { FillButton, Failures, useSave, useRowsSave, RowsSaver, RowsTable } from './onboardingParts';

// ------------------------------------------------------------------ steps

export function WelcomeStep({ c, onStart, onFilledAll }: { c: OnboardingContent; onStart: () => void; onFilledAll: () => void }) {
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

/** The company's name, currency and time zone are asked once, on the sign-up "Set up your company" page (Ben, 10 Nov 2026: "why 2 pages").
 *  Here they are shown read-only with a link to change them in Settings; only the date format, which sign-up does not ask, is set here. */
export function CompanyStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const reload = useReloadSession();
  const canManage = hasPermission(session.permissions, 'core.org.manage');
  const org = session.org;
  const [dateFormat, setDateFormat] = useState(org?.dateFormat ?? 'DD/MM/YYYY');
  const { busy, error, run } = useSave(onDone);
  if (!canManage) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const fill = () => setDateFormat(SAMPLE_COMPANY.dateFormat);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (dateFormat !== org?.dateFormat) {
        await api('/v1/core/org', { method: 'PATCH', body: JSON.stringify({ dateFormat }) });
        reload();
      }
    });
  };
  return (
    <>
      <FillButton c={c} onFill={fill} />
      <div className="mb-4 rounded-lg border border-border p-3 text-sm">
        <dl className="m-0 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="font-medium">{c.company.name}</dt>
          <dd className="m-0">{org?.name}</dd>
          <dt className="font-medium">{c.company.currency}</dt>
          <dd className="m-0">{org?.defaultCurrency}</dd>
          <dt className="font-medium">{c.company.timezone}</dt>
          <dd className="m-0" dir="ltr">{org?.timezone}</dd>
        </dl>
        <p className="m-0 mt-2 text-xs text-muted-foreground">
          {tr('You entered these when you set up your company.')} <Link to="/settings">{tr('Change them in Settings')}</Link>
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
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
          <Saver c={c} busy={busy} error={error} />
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
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<{ id: string; code: string; name: string } | null>(null);
  const existing = useList<{ id: string; code: string; name: string }>('/v1/inventory/warehouses', hasPermission(session.permissions, 'inventory.items.read'), version);
  const conditions = useList<{ id: string; name: string }>('/v1/inventory/storage-conditions', hasPermission(session.permissions, 'inventory.batches.read'), 0);
  const blank = (): SampleWarehouse => ({ code: '', name: '', nameAr: '', condition: '' });
  const [rows, setRows] = useState<SampleWarehouse[]>([{ ...blank(), code: 'MAIN' }]);
  const saver = useRowsSave(onDone);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const filled = rows.filter((r) => r.code.trim() && r.name.trim());
  return (
    <>
      <FillButton c={c} onFill={() => setRows(SAMPLE_WAREHOUSES.map((x) => ({ ...x })))} />
      {existing && existing.length > 0 ? (
        <div className="mb-3">
          <p className="m-0 mb-1 text-sm">{c.warehouse.existing(existing.length)}</p>
          <ul className="m-0 list-none p-0 text-sm">
            {existing.map((w) => (
              <li key={w.id} className="flex items-center gap-2 py-1">
                <span>
                  <code>{w.code}</code> · {w.name}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing(w)}>
                  {tr('Edit')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {editing ? (
        <EditWarehouseModal
          warehouse={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
      <datalist id="onb-conditions">
        {(conditions ?? []).map((x) => (
          <option key={x.id} value={x.name} />
        ))}
      </datalist>
      <RowsTable<SampleWarehouse>
        cols={[
          { key: 'code', label: c.warehouse.code, width: '9rem' },
          { key: 'name', label: c.warehouse.name },
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
