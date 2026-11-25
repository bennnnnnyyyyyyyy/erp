import { useCallback, useEffect, useRef, useState } from 'react';
import {
  findReportTemplate,
  hasPermission,
  reportDefinitionProblem,
  reportFnsFor,
  type ReportColumnType,
  type ReportDefinition,
  type ReportResult,
  type ReportSource,
  type SavedReport,
} from '@erp/shared';
import { ApiError, api } from '../../lib/api';
import { currentLanguage, tr } from '../../lib/i18n';
import { navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { saveBlob, sheetToPdf } from '../sales/print/pdf';
import { NEW_META, RUN_DELAY_MS, startingDefinition, type Meta } from './Builder';
import { cellValue, headerLabel } from './cells';
import { presetPeriod, templateDefinition, tidy } from './definition';
import { sourceLabel } from './labels';
import { measureChoices, measureOf, periodChoice, splitOf, totalKey } from './sentence';
import { XLSX_TYPE, xlsxBytes } from './xlsx';

// The report builder's logic for the new-UI versions (BuilderNew.tsx, Design Lab "Report builder"). Same rules and same API as the old
// page (Builder.tsx, Ben's pick A: one sentence); the old page keeps its own copy until a version is picked, then both use this hook.
// Dead ends (Ben, 25 Nov 2026): an error keeps its code, so the screen can offer the fix (a name already used opens the name box);
// an empty result says why and offers the change that fills it.

export type BuilderError = { message: string; code?: string };
const errorOf = (e: unknown): BuilderError => ({ message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined });

export function useReportBuilder() {
  const session = useSession();
  const id = useParam('id');
  const templateKey = useParam('key');
  const canCreate = hasPermission(session.permissions, 'reports.custom.create');
  const canManage = hasPermission(session.permissions, 'reports.custom.manage');
  const canAlert = hasPermission(session.permissions, 'alerts.rules.manage');
  const sources = useLoad(() => api<ReportSource[]>('/v1/reports/sources'));
  const [def, setDef] = useState<ReportDefinition | null>(null);
  const [meta, setMeta] = useState<Meta>(NEW_META);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<BuilderError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notOpen, setNotOpen] = useState(false);
  const runSeq = useRef(0);
  const source = sources.data?.find((s) => s.key === def?.source);

  const run = useCallback(async (d: ReportDefinition, src: ReportSource | undefined) => {
    const clean = tidy(d);
    if (reportDefinitionProblem(clean, src)) return;
    const seq = ++runSeq.current;
    setRunning(true);
    try {
      const r = await api<ReportResult>('/v1/reports/run', { method: 'POST', body: JSON.stringify({ definition: clean }) });
      if (seq === runSeq.current) {
        setResult(r);
        setError(null);
      }
    } catch (e) {
      if (seq === runSeq.current) setError(errorOf(e));
    } finally {
      if (seq === runSeq.current) setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!sources.data) return;
    setNotOpen(false);
    if (templateKey) {
      const t = findReportTemplate(templateKey);
      const src = t && sources.data.find((s) => s.key === t.definition.source);
      if (!t || !src) {
        setDef(null);
        setNotOpen(true);
        return;
      }
      setMeta({ ...NEW_META, name: tr(t.name), description: tr(t.description), templateKey: t.key });
      setDef(templateDefinition(t));
    } else if (id) {
      api<SavedReport>(`/v1/reports/saved/${id}`)
        .then((r) => {
          setMeta({ id: r.id, name: r.name, description: r.description ?? '', visibility: r.visibility, mine: r.mine, templateKey: r.templateKey });
          setDef(r.definition);
          setDirty(false);
        })
        .catch((e) => {
          setError(errorOf(e));
          setNotOpen(true);
        });
    } else {
      setMeta(NEW_META);
      setResult(null);
      const first = sources.data[0];
      setDef(first ? startingDefinition(first) : null);
    }
  }, [sources.data, id, templateKey]);

  const defKey = def ? JSON.stringify(def) : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: def is read through defKey
  useEffect(() => {
    if (!def || !source) return;
    const t = setTimeout(() => void run(def, source), RUN_DELAY_MS);
    return () => clearTimeout(t);
  }, [defKey, source, run]);

  const set = (next: ReportDefinition) => {
    setDef(next);
    setSaved(null);
    setDirty(true);
  };
  const patch = (p: Partial<ReportDefinition>) => def && set({ ...def, ...p });
  const pickSource = (key: string) => {
    const s = sources.data?.find((x) => x.key === key);
    if (s) {
      set(startingDefinition(s));
      setResult(null);
    }
  };

  const canEditSaved = !!meta.id && (meta.visibility === 'private' ? meta.mine && canCreate : canManage);
  const fileBase = (meta.name || (def ? tr(sourceLabel(def.source)) : '')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'report';

  async function save(asNew: boolean): Promise<boolean> {
    if (!def) return false;
    setBusy('save');
    setError(null);
    try {
      const body = JSON.stringify({ name: meta.name, description: meta.description || null, definition: tidy(def), visibility: meta.visibility, templateKey: meta.templateKey });
      if (meta.id && !asNew) {
        await api(`/v1/reports/saved/${meta.id}`, { method: 'PATCH', body });
        setSaved(tr('Saved.'));
        setDirty(false);
      } else {
        const r = await api<{ id: string }>('/v1/reports/saved', { method: 'POST', body });
        navigate(`/reports/${r.id}`);
      }
      return true;
    } catch (e) {
      setError(errorOf(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!meta.id) return;
    setBusy('delete');
    try {
      await api(`/v1/reports/saved/${meta.id}`, { method: 'DELETE' });
      navigate('/reports');
    } catch (e) {
      setError(errorOf(e));
      setBusy(null);
    }
  }

  function exportExcel() {
    if (!result) return;
    const header = result.columns.map((c) => (c.type === 'currency' ? tr('Currency') : headerLabel(c.key, result)));
    const rows = result.rows.map((r) => r.map((v, i) => cellValue(v, result.columns[i]?.type ?? 'text', result.columns[i]?.key ?? '')));
    if (result.totals.length > 0) {
      rows.push([]);
      rows.push([tr('Totals'), ...result.totals.map((t) => headerLabel(t.key, result))]);
      for (const line of result.totalRows) {
        rows.push([line.currency ?? '', ...line.values.map((v, i) => cellValue(v, result.totals[i]?.type ?? 'number', result.totals[i]?.column ?? ''))]);
      }
    }
    const bytes = xlsxBytes(fileBase, header, rows, currentLanguage() === 'ar');
    saveBlob(new Blob([bytes as BlobPart], { type: XLSX_TYPE }), `${fileBase}.xlsx`);
  }

  async function exportPdf(sheet: HTMLElement | null) {
    if (!sheet) return;
    setBusy('pdf');
    try {
      saveBlob(await sheetToPdf(sheet), `${fileBase}.pdf`);
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(null);
    }
  }

  const typeOf = (k: string): ReportColumnType => source?.columns.find((c) => c.key === k)?.type ?? 'text';
  const totalsShown = new Set((def?.totals ?? []).map(totalKey));
  const moreTotals = source
    ? source.columns.flatMap((c) => reportFnsFor(c.type).filter((fn) => fn !== 'count' || c === source.columns[0]).map((fn) => `${fn}_${c.key}`)).filter((k) => !totalsShown.has(k))
    : [];

  /** Why "Alert me when" cannot be used yet, in plain words, or null when it can (dead ends: say why, never just hide it). */
  const alertBlock: string | null = !canAlert
    ? null
    : !meta.id
      ? 'To be alerted, save this report for the company first.'
      : meta.visibility !== 'company'
        ? 'Alerts work on company reports: save a copy for the company.'
        : (def?.totals ?? []).length === 0
          ? 'Alerts watch a total: choose a number to show, not a list.'
          : dirty
            ? 'Save your changes first.'
            : null;

  return {
    session, sources, def, meta, setMeta, result, error, setError, busy, running, saved, setSaved, dirty, notOpen,
    source, set, patch, pickSource, save, remove, exportExcel, exportPdf,
    canCreate, canManage, canAlert, canEditSaved, alertBlock,
    problem: def && source ? reportDefinitionProblem(tidy(def), source) : null,
    measure: def ? measureOf(def) : '', split: def ? splitOf(def) : '', period: def ? periodChoice(def) : 'any',
    measures: source ? measureChoices(source) : [], moreTotals, typeOf,
    widen: () => patch({ period: presetPeriod('last_12_months') }),
  };
}
