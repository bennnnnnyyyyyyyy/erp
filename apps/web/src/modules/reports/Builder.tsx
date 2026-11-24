import { useCallback, useEffect, useRef, useState } from 'react';
import {
  REPORT_CHART_TYPES,
  REPORT_LIMITS,
  findReportTemplate,
  hasPermission,
  reportDefinitionProblem,
  reportFnsFor,
  reportOpsFor,
  reportOutputKeys,
  type ReportChartType,
  type ReportColumnType,
  type ReportDefinition,
  type ReportFilter,
  type ReportFilterOp,
  type ReportResult,
  type ReportSource,
  type ReportVisibility,
  type SavedReport,
} from '@erp/shared';
import { DateInput } from '../../components/DateInput';
import { ConfirmButton } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { currentLanguage, tr, trf } from '../../lib/i18n';
import { parseAmount } from '../../lib/numbers';
import { navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { saveBlob, sheetToPdf } from '../sales/print/pdf';
import { cellText, cellValue, headerLabel } from './cells';
import { presetPeriod, templateDefinition, tidy } from './definition';
import { VALUE_LABELS, columnLabel, opLabel, sourceLabel } from './labels';
import { ReportAlert } from './ReportAlert';
import { ReportChart } from './ReportChart';
import {
  LIST,
  REPORT_PERIOD_PRESETS_SHOWN,
  defaultMeasure,
  measureChoices,
  measureOf,
  parseTotal,
  periodChoice,
  splitChoices,
  splitOf,
  totalKey,
  withMeasure,
  withSplit,
} from './sentence';
import { XLSX_TYPE, xlsxBytes } from './xlsx';

// Reports & Insights, step 2 (REPORTS_INSIGHTS_PLAN.md, sql/109): build a report from the fixed list of sources the database offers this
// person, see it, save it (for yourself, or for the company), and export it to Excel or PDF or print it. The screen never sends SQL:
// it sends a definition, which the API and the database both check; the database runs it for this company only.
// The settings are one sentence (Ben, 24 Nov 2026, option A): "Show [what] by [split] for [period]", with "Only include", "Also show" and
// "Split again" under it. The report runs by itself a moment after each change.

type Meta = { id: string | null; name: string; description: string; visibility: ReportVisibility; mine: boolean; templateKey: string | null };
type Panel = { kind: 'filter'; index: number } | { kind: 'also' } | { kind: 'split2' } | { kind: 'more' } | null;
const NEW_META: Meta = { id: null, name: '', description: '', visibility: 'private', mine: true, templateKey: null };
const PDF_MAX_ROWS = 1000;
const RUN_DELAY_MS = 350;
const PERIOD_LABELS: Record<string, string> = { this_month: 'This month', last_month: 'Last month', last_30: 'Last 30 days', this_year: 'This year' };
const CHART_LABELS: Record<ReportChartType, string> = { bar: 'Bars', line: 'Line', pie: 'Pie' };

/** A new report on a source: its whole amount added up, every line, this month. */
export function startingDefinition(s: ReportSource): ReportDefinition {
  const base: ReportDefinition = { source: s.key, columns: s.columns.slice(0, 5).map((c) => c.key), period: s.period ? presetPeriod('this_month') : null };
  return withMeasure(base, defaultMeasure(s), s);
}

/** The name of a "what" choice: the column for a sum ("Total"), "Number of lines" for a count, else "Average of Net". */
function measureLabel(key: string): string {
  if (key === LIST) return tr('Each line (a list)');
  return headerLabel(key);
}

export function ReportBuilderPage() {
  const session = useSession();
  const id = useParam('id');
  const templateKey = useParam('key');
  const canCreate = hasPermission(session.permissions, 'reports.custom.create');
  const canManage = hasPermission(session.permissions, 'reports.custom.manage');
  const sources = useLoad(() => api<ReportSource[]>('/v1/reports/sources'));
  const [def, setDef] = useState<ReportDefinition | null>(null);
  const [meta, setMeta] = useState<Meta>(NEW_META);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [datesOpen, setDatesOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // Step 5: "Alert me when" works on the report as saved, so it waits for unsaved changes to be saved.
  const [dirty, setDirty] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const canAlert = hasPermission(session.permissions, 'alerts.rules.manage');
  const sheet = useRef<HTMLDivElement>(null);
  const runSeq = useRef(0);
  const source = sources.data?.find((s) => s.key === def?.source);

  // Only the latest run shows: a slower earlier answer is dropped.
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
      if (seq === runSeq.current) setError((e as Error).message);
    } finally {
      if (seq === runSeq.current) setRunning(false);
    }
  }, []);

  // Open a saved report, or a ready-made one (step 3: "Save" keeps the person's own copy), or start a new one. It runs by itself (below).
  useEffect(() => {
    if (!sources.data) return;
    setPanel(null);
    setDatesOpen(false);
    if (templateKey) {
      const t = findReportTemplate(templateKey);
      const src = t && sources.data.find((s) => s.key === t.definition.source);
      if (!t || !src) {
        setDef(null);
        setError(tr('This ready-made report is not open to you.'));
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
        .catch((e: Error) => setError(e.message));
    } else {
      setMeta(NEW_META);
      setResult(null);
      const first = sources.data[0];
      setDef(first ? startingDefinition(first) : null);
    }
  }, [sources.data, id, templateKey]);

  // The report follows the sentence: a moment after the last change, it runs again.
  const defKey = def ? JSON.stringify(def) : '';
  // defKey stands for def: the run waits for the settings to change, not for a new object with the same settings.
  // biome-ignore lint/correctness/useExhaustiveDependencies: def is read through defKey
  useEffect(() => {
    if (!def || !source) return;
    const t = setTimeout(() => void run(def, source), RUN_DELAY_MS);
    return () => clearTimeout(t);
  }, [defKey, source, run]);

  if (!sources.data) return <section className="page"><Loading error={sources.error} /></section>;
  if (sources.data.length === 0) {
    return (
      <section className="page">
        <h1>{tr('New report')}</h1>
        <p className="muted">{tr('No data is open to you for reports yet. Ask an admin for access.')}</p>
      </section>
    );
  }
  if (!def || !source) return <section className="page"><Loading error={error} /></section>;

  const set = (next: ReportDefinition) => {
    setDef(next);
    setSaved(null);
    setDirty(true);
  };
  const patch = (p: Partial<ReportDefinition>) => set({ ...def, ...p });
  const groups = def.groupBy ?? [];
  const grouped = groups.length > 0;
  const measure = measureOf(def);
  const split = splitOf(def);
  const outKeys = reportOutputKeys(tidy(def));
  const problem = reportDefinitionProblem(tidy(def), source);
  const typeOf = (k: string): ReportColumnType => source.columns.find((c) => c.key === k)?.type ?? 'text';
  const measures = measureChoices(source);
  const period = periodChoice(def);
  const showDates = !!source.period && (period === 'custom' || datesOpen);
  const canEditSaved = !!meta.id && (meta.visibility === 'private' ? meta.mine && canCreate : canManage);
  const fileBase = (meta.name || tr(sourceLabel(def.source))).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'report';
  const curIdx = result?.columns.findIndex((c) => c.type === 'currency') ?? -1;
  const label = (raw: unknown, key: string) => {
    const col = result?.columns.find((c) => c.key === key);
    return cellText((raw ?? null) as string | number | null, col?.type ?? 'text', key, session.org?.defaultCurrency ?? null, session.org);
  };
  const toggle = (p: NonNullable<Panel>) => setPanel((cur) => (cur && cur.kind === p.kind && (p.kind !== 'filter' || (cur.kind === 'filter' && cur.index === p.index)) ? null : p));
  // "Also show": every total that fits a column, not yet shown.
  const totalsShown = new Set((def.totals ?? []).map(totalKey));
  const moreTotals = source.columns.flatMap((c) => reportFnsFor(c.type).filter((fn) => fn !== 'count' || c === source.columns[0]).map((fn) => `${fn}_${c.key}`)).filter((k) => !totalsShown.has(k));

  async function save(asNew: boolean) {
    if (!def) return;
    setBusy('save');
    setError(null);
    try {
      const body = JSON.stringify({ name: meta.name, description: meta.description || null, definition: tidy(def), visibility: meta.visibility, templateKey: meta.templateKey });
      if (meta.id && !asNew) {
        await api(`/v1/reports/saved/${meta.id}`, { method: 'PATCH', body });
        setSaved(tr('Saved.'));
        setDirty(false);
        setSaveOpen(false);
      } else {
        const r = await api<{ id: string }>('/v1/reports/saved', { method: 'POST', body });
        setSaveOpen(false);
        navigate(`/reports/${r.id}`);
      }
    } catch (e) {
      setError((e as Error).message);
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
      setError((e as Error).message);
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

  async function exportPdf() {
    if (!sheet.current) return;
    setBusy('pdf');
    try {
      saveBlob(await sheetToPdf(sheet.current), `${fileBase}.pdf`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const filters = def.filters ?? [];
  const openFilter = panel?.kind === 'filter' ? filters[panel.index] : undefined;

  return (
    <section className="page wide">
      <h1>{meta.id || meta.templateKey ? meta.name : tr('New report')}</h1>
      {!meta.id && meta.templateKey && <p className="muted small no-print">{tr('A ready-made report. Change anything and save it as your own.')}</p>}
      {meta.description && <p className="muted">{meta.description}</p>}
      {meta.id && !canEditSaved && <p className="muted small no-print">{tr('You can change the settings and see the result, but only save them as a new report.')}</p>}

      <div className="rb no-print">
        <label className="rb-data">
          <span className="muted small">{tr('Data')}</span>
          <select
            value={def.source}
            onChange={(e) => {
              const s = sources.data?.find((x) => x.key === e.target.value);
              if (s) {
                set(startingDefinition(s));
                setResult(null);
                setPanel(null);
              }
            }}
          >
            {sources.data.map((s) => <option key={s.key} value={s.key}>{tr(sourceLabel(s.key))}</option>)}
          </select>
        </label>

        <div className="rb-sentence">
          <span>{tr('Show')}</span>
          <select aria-label={tr('What to show')} value={measure} onChange={(e) => set(withMeasure(def, e.target.value, source))}>
            {[...measures, ...(measures.includes(measure) ? [] : [measure])].map((k) => <option key={k} value={k}>{measureLabel(k)}</option>)}
          </select>
          {measure !== LIST && (
            <>
              <span>{tr('by')}</span>
              <select aria-label={tr('Split by')} value={split} onChange={(e) => set(withSplit(def, e.target.value, source))}>
                <option value="">{tr('Nothing (every line)')}</option>
                {splitChoices(source).map((k) => <option key={k} value={k}>{tr(columnLabel(k))}</option>)}
              </select>
            </>
          )}
          {source.period && (
            <>
              <span>{tr('for')}</span>
              <select
                aria-label={tr('Period')}
                value={showDates ? 'custom' : period}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'custom') {
                    setDatesOpen(true);
                    if (!def.period) patch({ period: presetPeriod('this_month') });
                  } else {
                    setDatesOpen(false);
                    patch({ period: v === 'any' ? null : presetPeriod(v as (typeof REPORT_PERIOD_PRESETS_SHOWN)[number]) });
                  }
                }}
              >
                {REPORT_PERIOD_PRESETS_SHOWN.map((k) => <option key={k} value={k}>{tr(PERIOD_LABELS[k] as string)}</option>)}
                {!source.periodRequired && <option value="any">{tr('Any date')}</option>}
                <option value="custom">{tr('Pick dates…')}</option>
              </select>
            </>
          )}
        </div>

        {showDates && (
          <div className="rb-dates">
            <DateInput aria-label={tr('From')} value={def.period?.from ?? ''} onChange={(e) => patch({ period: { from: e.target.value, to: def.period?.to ?? e.target.value } })} />
            <span aria-hidden="true">–</span>
            <DateInput aria-label={tr('To')} value={def.period?.to ?? ''} onChange={(e) => patch({ period: { from: def.period?.from ?? e.target.value, to: e.target.value } })} />
          </div>
        )}

        <div className="rb-chips">
          {filters.map((f, i) => (
            <span key={i} className="rb-chip" data-on={panel?.kind === 'filter' && panel.index === i}>
              <button type="button" className="rb-chip-text" onClick={() => toggle({ kind: 'filter', index: i })}>
                {filterText(f, typeOf(f.column), session.org)}
              </button>
              <button
                type="button"
                className="rb-chip-x"
                aria-label={tr('Remove')}
                onClick={() => {
                  patch({ filters: filters.filter((_, n) => n !== i) });
                  setPanel(null);
                }}
              >
                ✕
              </button>
            </span>
          ))}
          {groups[1] && (
            <span className="rb-chip">
              <span className="rb-chip-text">{trf('then by {column}', { column: tr(columnLabel(groups[1])) })}</span>
              <button type="button" className="rb-chip-x" aria-label={tr('Remove')} onClick={() => patch({ groupBy: groups.slice(0, 1) })}>✕</button>
            </span>
          )}
          {(def.totals ?? []).slice(1).map((t) => (
            <span key={totalKey(t)} className="rb-chip">
              <span className="rb-chip-text">{trf('also {what}', { what: headerLabel(totalKey(t)) })}</span>
              <button
                type="button"
                className="rb-chip-x"
                aria-label={tr('Remove')}
                onClick={() => set(withMeasure({ ...def, totals: (def.totals ?? []).filter((x) => totalKey(x) !== totalKey(t)) }, measure, source))}
              >
                ✕
              </button>
            </span>
          ))}
          {filters.length < REPORT_LIMITS.filters && (
            <button
              type="button"
              className="rb-chip add"
              onClick={() => {
                const c = source.columns.find((x) => x.type === 'text') ?? source.columns[0];
                if (!c) return;
                patch({ filters: [...filters, { column: c.key, op: reportOpsFor(c.type)[0] as ReportFilterOp, value: null }] });
                setPanel({ kind: 'filter', index: filters.length });
              }}
            >
              {tr('+ Only include…')}
            </button>
          )}
          <button type="button" className="rb-chip add" aria-pressed={panel?.kind === 'also'} onClick={() => toggle({ kind: 'also' })}>{tr('+ Also show…')}</button>
          {grouped && !groups[1] && (
            <button type="button" className="rb-chip add" aria-pressed={panel?.kind === 'split2'} onClick={() => toggle({ kind: 'split2' })}>{tr('+ Split again by…')}</button>
          )}
          <button type="button" className="rb-chip add" aria-pressed={panel?.kind === 'more'} onClick={() => toggle({ kind: 'more' })}>{tr('Order and rows…')}</button>
        </div>

        {panel?.kind === 'filter' && openFilter && (
          <div className="rb-editor">
            <span className="muted small">{tr('Only include lines where')}</span>
            <FilterRow
              key={panel.index}
              source={source}
              filter={openFilter}
              onChange={(nf) => patch({ filters: filters.map((x, n) => (n === panel.index ? nf : x)) })}
            />
            <div><Button size="sm" variant="outline" onClick={() => setPanel(null)}>{tr('Done')}</Button></div>
          </div>
        )}

        {panel?.kind === 'also' && (
          <div className="rb-editor">
            {measure !== LIST && (def.totals ?? []).length < REPORT_LIMITS.totals && (
              <label>
                <span className="muted small">{tr('Add a number')}</span>
                <select
                  value=""
                  onChange={(e) => {
                    const t = parseTotal(e.target.value);
                    if (t) patch({ totals: [...(def.totals ?? []), t] });
                  }}
                >
                  <option value="">{tr('Choose…')}</option>
                  {moreTotals.map((k) => <option key={k} value={k}>{headerLabel(k)}</option>)}
                </select>
              </label>
            )}
            {!grouped && (
              <fieldset className="rb-columns">
                <legend className="muted small">{tr('Columns in the list')}</legend>
                <div className="report-checks">
                  {source.columns.map((c) => {
                    const on = (def.columns ?? []).includes(c.key);
                    return (
                      <label key={c.key} className="check">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => patch({ columns: on ? (def.columns ?? []).filter((k) => k !== c.key) : [...(def.columns ?? []), c.key] })}
                        />
                        {tr(columnLabel(c.key))}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <div><Button size="sm" variant="outline" onClick={() => setPanel(null)}>{tr('Done')}</Button></div>
          </div>
        )}

        {panel?.kind === 'split2' && (
          <div className="rb-editor">
            <label>
              <span className="muted small">{tr('Split each row again by')}</span>
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  patch({ groupBy: [groups[0] as string, e.target.value] });
                  setPanel(null);
                }}
              >
                <option value="">{tr('Choose…')}</option>
                {splitChoices(source).filter((k) => k !== groups[0]).map((k) => <option key={k} value={k}>{tr(columnLabel(k))}</option>)}
              </select>
            </label>
          </div>
        )}

        {panel?.kind === 'more' && (
          <div className="rb-editor rb-row">
            <label>
              <span className="muted small">{tr('Sort by')}</span>
              <select value={def.sort?.[0]?.column ?? ''} onChange={(e) => patch({ sort: e.target.value ? [{ column: e.target.value, dir: def.sort?.[0]?.dir ?? 'desc' }] : [] })}>
                <option value="">{tr('Standard order')}</option>
                {outKeys.map((k) => <option key={k} value={k}>{headerLabel(k, result ?? undefined)}</option>)}
              </select>
            </label>
            {def.sort?.[0] && (
              <label>
                <span className="muted small">{tr('Direction')}</span>
                <select value={def.sort[0].dir} onChange={(e) => patch({ sort: [{ column: def.sort?.[0]?.column as string, dir: e.target.value as 'asc' | 'desc' }] })}>
                  <option value="desc">{tr('Largest or newest first')}</option>
                  <option value="asc">{tr('Smallest or oldest first')}</option>
                </select>
              </label>
            )}
            <label>
              <span className="muted small">{tr('Show at most (rows)')}</span>
              <input
                type="number"
                min={1}
                max={REPORT_LIMITS.rows}
                inputMode="numeric"
                placeholder={String(REPORT_LIMITS.rows)}
                value={def.limit ?? ''}
                onChange={(e) => patch({ limit: e.target.value ? Math.min(REPORT_LIMITS.rows, Math.max(1, Math.trunc(Number(e.target.value)) || 1)) : null })}
              />
            </label>
            <div><Button size="sm" variant="outline" onClick={() => setPanel(null)}>{tr('Done')}</Button></div>
          </div>
        )}
      </div>

      <div className="rb-bar no-print">
        {grouped && def.totals?.[0] ? (
          <div className="rb-chips">
            {REPORT_CHART_TYPES.map((c) => (
              <button
                key={c}
                type="button"
                className="rb-chip"
                aria-pressed={def.chart?.type === c}
                onClick={() => patch({ chart: { type: c, x: groups[0] as string, y: totalKey(def.totals?.[0] as NonNullable<ReportDefinition['totals']>[number]) } })}
              >
                {tr(CHART_LABELS[c])}
              </button>
            ))}
            <button type="button" className="rb-chip" aria-pressed={!def.chart} onClick={() => patch({ chart: null })}>{tr('Table only')}</button>
          </div>
        ) : <span />}
        <div className="report-actions">
          {running && <span className="muted small" aria-live="polite">{tr('Working…')}</span>}
          {canCreate && (
            <Button disabled={busy !== null} onClick={() => setSaveOpen((o) => !o)}>
              {meta.id && canEditSaved ? tr('Save changes') : tr('Save')}
            </Button>
          )}
          <Button variant="outline" disabled={!result || busy !== null} onClick={exportExcel}>{tr('Excel')}</Button>
          <Button variant="outline" disabled={!result || busy !== null || (result?.rows.length ?? 0) > PDF_MAX_ROWS} onClick={exportPdf}>
            {busy === 'pdf' ? tr('Working…') : tr('PDF')}
          </Button>
          <Button variant="outline" disabled={!result} onClick={() => window.print()}>{tr('Print')}</Button>
          {meta.id && meta.visibility === 'company' && canAlert && (def.totals ?? []).length > 0 && (
            <Button variant="outline" disabled={busy !== null || dirty} title={dirty ? tr('Save your changes first.') : undefined} onClick={() => setAlertOpen((o) => !o)}>
              {tr('Alert me when')}
            </Button>
          )}
          {meta.id && canEditSaved && (
            <ConfirmButton label={tr('Delete')} confirmLabel={tr('Yes, delete')} question={trf('Delete the report "{name}"?', { name: meta.name })} disabled={busy !== null} onConfirm={remove} />
          )}
          {saved && <span className="muted small">{saved}</span>}
        </div>
      </div>
      {result && result.rows.length > PDF_MAX_ROWS && <p className="muted small no-print">{trf('A PDF holds up to {n} rows: use Excel for more.', { n: PDF_MAX_ROWS })}</p>}

      {alertOpen && meta.id && !dirty && (
        <ReportAlert
          reportId={meta.id}
          reportName={meta.name}
          totals={def.totals ?? []}
          source={source}
          onClose={(message) => {
            setAlertOpen(false);
            if (message) setSaved(message);
          }}
        />
      )}

      {saveOpen && (
        <fieldset className="report-panel no-print">
          <legend>{tr('Save the report')}</legend>
          <div className="report-row">
            <label>
              {tr('Name')}
              <input value={meta.name} maxLength={100} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
            </label>
            <label>
              {tr('Who sees it')}
              <select value={meta.visibility} onChange={(e) => setMeta({ ...meta, visibility: e.target.value as ReportVisibility })}>
                <option value="private">{tr('Only me')}</option>
                {canManage && <option value="company">{tr('Everyone in the company who may see this data')}</option>}
              </select>
            </label>
          </div>
          <label>
            {tr('Description (optional)')}
            <input value={meta.description} maxLength={500} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
          </label>
          <div className="report-actions">
            {meta.id && canEditSaved && <Button disabled={busy !== null || !meta.name.trim()} onClick={() => save(false)}>{tr('Save changes')}</Button>}
            <Button variant={meta.id && canEditSaved ? 'outline' : 'default'} disabled={busy !== null || !meta.name.trim()} onClick={() => save(true)}>
              {meta.id ? tr('Save as a new report') : tr('Save')}
            </Button>
          </div>
        </fieldset>
      )}

      {problem && <p className="muted no-print">{tr(problem)}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {result && (
        <div ref={sheet} className="report-sheet" aria-busy={running}>
          <h2 className="report-title">{meta.name || tr(sourceLabel(def.source))}</h2>
          {def.period && <p className="muted small">{trf('{from} to {to}', { from: formatDay(def.period.from, session.org), to: formatDay(def.period.to, session.org) })}</p>}
          {def.chart && grouped && <ReportChart result={result} type={def.chart.type} x={def.chart.x} y={def.chart.y} label={label} />}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th key={c.key} scope="col" className={c.type === 'money' || c.type === 'number' ? 'right' : undefined}>
                      {c.type === 'currency' ? tr('Currency') : headerLabel(c.key, result)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => {
                      const col = result.columns[j];
                      const cur = curIdx >= 0 ? (r[curIdx] as string | null) : (session.org?.defaultCurrency ?? null);
                      return (
                        <td key={j} className={col?.type === 'money' || col?.type === 'number' ? 'right' : undefined}>
                          {cellText(v, col?.type ?? 'text', col?.key ?? '', cur, session.org)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {result.rows.length === 0 && <tr><td colSpan={result.columns.length} className="muted empty">{tr('No rows match.')}</td></tr>}
              </tbody>
            </table>
          </div>
          {result.truncated && <p className="muted small">{trf('Showing the first {n} rows. Narrow the period or add a filter to see the rest.', { n: result.rows.length })}</p>}
          {result.totals.length > 0 && result.totalRows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{tr('Totals')}</th>
                    {result.totals.map((t) => <th key={t.key} scope="col" className="right">{headerLabel(t.key, result)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {result.totalRows.map((line) => (
                    <tr key={line.currency ?? 'all'}>
                      <td>{line.currency ?? tr('All rows')}</td>
                      {line.values.map((v, i) => (
                        <td key={i} className="right">
                          {cellText(v, result.totals[i]?.type ?? 'number', result.totals[i]?.column ?? '', line.currency ?? session.org?.defaultCurrency ?? null, session.org)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** A filter as a short sentence for its chip: "Customer contains Nile", "Total is more than 500". */
function filterText(f: ReportFilter, type: ReportColumnType, org: { dateFormat: string } | null): string {
  const one = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined || v === '') return '…';
    if (type === 'money') return (Number(v) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (type === 'date') return formatDay(String(v), org);
    const named = VALUE_LABELS[f.column]?.[String(v)];
    return named ? tr(named) : String(v);
  };
  const head = `${tr(columnLabel(f.column))} ${tr(opLabel(f.op, type))}`;
  if (f.op === 'is_empty') return head;
  const vals = Array.isArray(f.value) ? f.value : [f.value];
  return `${head} ${vals.map(one).join(f.op === 'between' ? ` ${tr('and')} ` : ', ')}`;
}

/** One filter: column, operator and value (or values), each fitting the column's type. Money is typed in pounds, sent in minor units. */
function FilterRow({ source, filter, onChange }: { source: ReportSource; filter: ReportFilter; onChange: (f: ReportFilter) => void }) {
  const type: ReportColumnType = source.columns.find((c) => c.key === filter.column)?.type ?? 'text';
  const ops = reportOpsFor(type);
  const values = VALUE_LABELS[filter.column];
  const pair = Array.isArray(filter.value) ? filter.value : [];
  return (
    <div className="report-row">
      <select
        aria-label={tr('Column')}
        value={filter.column}
        onChange={(e) => {
          const t = source.columns.find((c) => c.key === e.target.value)?.type ?? 'text';
          onChange({ column: e.target.value, op: reportOpsFor(t).includes(filter.op) ? filter.op : (reportOpsFor(t)[0] as ReportFilterOp), value: null });
        }}
      >
        {source.columns.map((c) => <option key={c.key} value={c.key}>{tr(columnLabel(c.key))}</option>)}
      </select>
      <select aria-label={tr('Condition')} value={filter.op} onChange={(e) => onChange({ ...filter, op: e.target.value as ReportFilterOp, value: null })}>
        {ops.map((op) => <option key={op} value={op}>{tr(opLabel(op, type))}</option>)}
      </select>
      {filter.op === 'is_empty' ? null : filter.op === 'between' ? (
        <>
          <ValueInput key={`${filter.column}-a`} type={type} value={pair[0] ?? null} onChange={(v) => onChange({ ...filter, value: [v ?? '', pair[1] ?? ''] as (string | number)[] })} />
          <span>{tr('and')}</span>
          <ValueInput key={`${filter.column}-b`} type={type} value={pair[1] ?? null} onChange={(v) => onChange({ ...filter, value: [pair[0] ?? '', v ?? ''] as (string | number)[] })} />
        </>
      ) : filter.op === 'in' ? (
        <input
          key={filter.column}
          aria-label={tr('Values')}
          placeholder={tr('Separate values with commas')}
          defaultValue={pair.join(', ')}
          onChange={(e) => onChange({ ...filter, value: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50) })}
        />
      ) : values && (filter.op === 'eq' || filter.op === 'ne') ? (
        <select aria-label={tr('Value')} value={typeof filter.value === 'string' ? filter.value : ''} onChange={(e) => onChange({ ...filter, value: e.target.value || null })}>
          <option value="">{tr('Choose…')}</option>
          {Object.entries(values).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
        </select>
      ) : (
        <ValueInput key={filter.column} type={type} value={(filter.value as string | number | null) ?? null} onChange={(v) => onChange({ ...filter, value: v })} />
      )}
    </div>
  );
}

/** A value box for one column type: dates with the date box, money in pounds (kept in minor units), numbers as typed. */
function ValueInput({ type, value, onChange }: { type: ReportColumnType; value: string | number | null; onChange: (v: string | number | null) => void }) {
  const shown = value === null || value === '' ? '' : type === 'money' ? String(Number(value) / 100) : String(value);
  const [text, setText] = useState(shown);
  if (type === 'date') return <DateInput aria-label={tr('Value')} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} />;
  return (
    <input
      aria-label={tr('Value')}
      inputMode={type === 'text' ? undefined : 'decimal'}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (type === 'text') return onChange(e.target.value.trim() || null);
        const n = parseAmount(e.target.value);
        onChange(Number.isFinite(n) ? (type === 'money' ? Math.round(n * 100) : n) : null);
      }}
    />
  );
}
