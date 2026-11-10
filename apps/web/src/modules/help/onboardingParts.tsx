import { useState } from 'react';
import { Button } from '../../components/ui/button';
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
import { inputClass, useCanFill } from './onboardingShared';

// ------------------------------------------------------------------ shared pieces

/** The demo-only button that puts the sample into the form on screen. Nothing is saved until Save. */
export function FillButton({ c, onFill }: { c: OnboardingContent; onFill: () => void }) {
  if (!useCanFill()) return null;
  return (
    <div className="mb-4">
      <Button type="button" variant="secondary" onClick={onFill}>
        {c.fill.one}
      </Button>
    </div>
  );
}

export function Failures({ c, failed, error }: { c: OnboardingContent; failed: string[]; error: string | null }) {
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
export function useSave(onDone: () => void) {
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
export function useRowsSave(onDone: () => void) {
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

export function RowsSaver({ c, s, disabled, onSave }: { c: OnboardingContent; s: ReturnType<typeof useRowsSave>; disabled?: boolean; onSave: () => void }) {
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

/** `optional`: the column may be left empty; its header says so (demo note, 5 Nov: people could not tell what was required). */
export type Col<T> = { key: keyof T & string; label: string; type?: 'text' | 'number'; list?: string; width?: string; optional?: boolean };

/** An editable table: one input per cell, add and remove rows. Logical properties only, so it mirrors in Arabic. */
export function RowsTable<T extends Record<string, string | number | null>>({
  cols,
  rows,
  setRows,
  blank,
  addLabel,
  optionalLabel,
}: {
  cols: Col<T>[];
  rows: T[];
  setRows: (r: T[]) => void;
  blank: () => T;
  addLabel: string;
  optionalLabel: string;
}) {
  const set = (i: number, k: keyof T, v: string) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: cols.find((x) => x.key === k)?.type === 'number' ? (v === '' ? null : Number(v)) : v } : r)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            {cols.map((col) => (
              <th key={col.key} scope="col" className="text-start font-medium" style={col.width ? { width: col.width } : undefined}>
                {col.label}
                {col.optional ? <span className="block text-xs font-normal text-muted-foreground">({optionalLabel})</span> : null}
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
