import { useCallback, useEffect, useRef, useState } from 'react';
import {
  REPORT_CHART_TYPES,
  REPORT_LIMITS,
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
  type ReportTotalFn,
  type ReportVisibility,
  type SavedReport,
} from '@erp/shared';
import { DateInput } from '../../components/DateInput';
import { ConfirmButton } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { firstOfYearIn, todayIn } from '../../lib/dates';
import { formatDay } from '../../lib/format';
import { currentLanguage, tr, trf } from '../../lib/i18n';
import { parseAmount } from '../../lib/numbers';
import { navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { saveBlob, sheetToPdf } from '../sales/print/pdf';
import { cellText, cellValue, headerLabel } from './cells';
import { tidy } from './definition';
import { FN_LABELS, VALUE_LABELS, columnLabel, opLabel, sourceLabel } from './labels';
import { ReportChart } from './ReportChart';
import { XLSX_TYPE, xlsxBytes } from './xlsx';

// Reports & Insights, step 2 (REPORTS_INSIGHTS_PLAN.md, sql/109): build a report from the fixed list of sources the database offers this
// person, run it, save it (for yourself, or for the company), and export it to Excel or PDF or print it. The screen never sends SQL:
// it sends a definition, which the API and the database both check; the database runs it for this company only.

type Meta = { id: string | null; name: string; description: string; visibility: ReportVisibility; mine: boolean; templateKey: string | null };
const NEW_META: Meta = { id: null, name: '', description: '', visibility: 'private', mine: true, templateKey: null };
const PDF_MAX_ROWS = 1000;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function presetPeriod(kind: 'this_month' | 'last_month' | 'last_30' | 'this_year'): { from: string; to: string } {
  const today = todayIn();
  const t = new Date(`${today}T00:00:00Z`);
  if (kind === 'this_month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (kind === 'last_month') {
    const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
    return { from: ymd(first), to: ymd(last) };
  }
  if (kind === 'last_30') return { from: ymd(new Date(t.getTime() - 29 * 86_400_000)), to: today };
  return { from: firstOfYearIn(), to: today };
}

/** A new report on a source: its first columns, this month. */
export function startingDefinition(s: ReportSource): ReportDefinition {
  return { source: s.key, columns: s.columns.slice(0, 5).map((c) => c.key), period: s.period ? presetPeriod('this_month') : null };
}

export function ReportBuilderPage() {
  const session = useSession();
  const id = useParam('id');
  const canCreate = hasPermission(session.permissions, 'reports.custom.create');
  const canManage = hasPermission(session.permissions, 'reports.custom.manage');
  const sources = useLoad(() => api<ReportSource[]>('/v1/reports/sources'));
  const [def, setDef] = useState<ReportDefinition | null>(null);
  const [meta, setMeta] = useState<Meta>(NEW_META);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const source = sources.data?.find((s) => s.key === def?.source);

  const run = useCallback(async (d: ReportDefinition, src: ReportSource | undefined) => {
    const clean = tidy(d);
    const problem = reportDefinitionProblem(clean, src);
    if (problem) {
      setError(tr(problem));
      return;
    }
    setBusy('run');
    setError(null);
    try {
      setResult(await api<ReportResult>('/v1/reports/run', { method: 'POST', body: JSON.stringify({ definition: clean }) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  // Open a saved report, or start a new one on the first source.
  useEffect(() => {
    if (!sources.data) return;
    if (id) {
      api<SavedReport>(`/v1/reports/saved/${id}`)
        .then((r) => {
          setMeta({ id: r.id, name: r.name, description: r.description ?? '', visibility: r.visibility, mine: r.mine, templateKey: r.templateKey });
          setDef(r.definition);
          void run(r.definition, sources.data?.find((s) => s.key === r.definition.source));
        })
        .catch((e: Error) => setError(e.message));
    } else {
      setMeta(NEW_META);
      setResult(null);
      const first = sources.data[0];
      setDef(first ? startingDefinition(first) : null);
    }
  }, [sources.data, id, run]);

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

  const set = (patch: Partial<ReportDefinition>) => {
    setDef((d) => (d ? { ...d, ...patch } : d));
    setSaved(null);
  };
  const grouped = (def.groupBy ?? []).length > 0;
  const outKeys = reportOutputKeys(tidy(def));
  const typeOf = (k: string) => source.columns.find((c) => c.key === k)?.type ?? 'text';
  const canEditSaved = !!meta.id && (meta.visibility === 'private' ? meta.mine && canCreate : canManage);
  const fileBase = (meta.name || tr(sourceLabel(def.source))).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'report';
  const curIdx = result?.columns.findIndex((c) => c.type === 'currency') ?? -1;
  const label = (raw: unknown, key: string) => {
    const col = result?.columns.find((c) => c.key === key);
    return cellText((raw ?? null) as string | number | null, col?.type ?? 'text', key, session.org?.defaultCurrency ?? null, session.org);
  };

  async function save(asNew: boolean) {
    if (!def) return;
    setBusy('save');
    setError(null);
    try {
      const body = JSON.stringify({ name: meta.name, description: meta.description || null, definition: tidy(def), visibility: meta.visibility, templateKey: meta.templateKey });
      if (meta.id && !asNew) {
        await api(`/v1/reports/saved/${meta.id}`, { method: 'PATCH', body });
        setSaved(tr('Saved.'));
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

  return (
    <section className="page wide">
      <h1>{meta.id ? meta.name : tr('New report')}</h1>
      {meta.description && <p className="muted">{meta.description}</p>}
      {meta.id && !canEditSaved && <p className="muted small no-print">{tr('You can change the settings and run them, but only save them as a new report.')}</p>}

      <div className="report-builder no-print">
        <fieldset className="report-panel">
          <legend>{tr('What the report is about')}</legend>
          <label>
            {tr('Data')}
            <select
              value={def.source}
              onChange={(e) => {
                const s = sources.data?.find((x) => x.key === e.target.value);
                if (s) {
                  setDef(startingDefinition(s));
                  setResult(null);
                }
              }}
            >
              {sources.data.map((s) => <option key={s.key} value={s.key}>{tr(sourceLabel(s.key))}</option>)}
            </select>
          </label>
          {source.period && (
            <div className="report-period">
              <span>{trf('Period ({column})', { column: tr(columnLabel(source.period)) })}</span>
              <DateInput aria-label={tr('From')} value={def.period?.from ?? ''} onChange={(e) => set({ period: { from: e.target.value, to: def.period?.to ?? e.target.value } })} />
              <span aria-hidden="true">–</span>
              <DateInput aria-label={tr('To')} value={def.period?.to ?? ''} onChange={(e) => set({ period: { from: def.period?.from ?? e.target.value, to: e.target.value } })} />
              {(['this_month', 'last_month', 'last_30', 'this_year'] as const).map((k) => (
                <Button key={k} size="sm" variant="ghost" onClick={() => set({ period: presetPeriod(k) })}>
                  {tr({ this_month: 'This month', last_month: 'Last month', last_30: 'Last 30 days', this_year: 'This year' }[k])}
                </Button>
              ))}
              {!source.periodRequired && def.period && <Button size="sm" variant="ghost" onClick={() => set({ period: null })}>{tr('Any date')}</Button>}
            </div>
          )}
        </fieldset>

        <fieldset className="report-panel">
          <legend>{tr('Group and total')}</legend>
          <div className="report-row">
            {[0, 1].map((i) => (
              <label key={i}>
                {i === 0 ? tr('Group by') : tr('Then by')}
                <select
                  value={def.groupBy?.[i] ?? ''}
                  disabled={i === 1 && !def.groupBy?.[0]}
                  onChange={(e) => {
                    const g = [...(def.groupBy ?? [])];
                    if (e.target.value) g[i] = e.target.value;
                    else g.splice(i);
                    const groupBy = g.filter(Boolean).filter((k, n, a) => a.indexOf(k) === n);
                    set({ groupBy, totals: groupBy.length > 0 && (def.totals ?? []).length === 0 ? [{ column: groupBy[0] as string, fn: 'count' }] : def.totals });
                  }}
                >
                  <option value="">{i === 0 ? tr('No grouping: one row per line') : tr('Nothing')}</option>
                  {source.columns.filter((c) => c.type === 'text' || c.type === 'date').map((c) => <option key={c.key} value={c.key}>{tr(columnLabel(c.key))}</option>)}
                </select>
              </label>
            ))}
          </div>
          {(def.totals ?? []).map((t, i) => (
            <div key={`${t.fn}_${t.column}_${i}`} className="report-row">
              <select aria-label={tr('Total')} value={t.fn} onChange={(e) => set({ totals: (def.totals ?? []).map((x, n) => (n === i ? { ...x, fn: e.target.value as ReportTotalFn } : x)) })}>
                {reportFnsFor(typeOf(t.column)).map((fn) => <option key={fn} value={fn}>{tr(FN_LABELS[fn])}</option>)}
              </select>
              <span>{tr('of')}</span>
              <select
                aria-label={tr('Column')}
                value={t.column}
                onChange={(e) => {
                  const type = typeOf(e.target.value);
                  const fn = reportFnsFor(type).includes(t.fn) ? t.fn : (reportFnsFor(type)[0] as ReportTotalFn);
                  set({ totals: (def.totals ?? []).map((x, n) => (n === i ? { column: e.target.value, fn } : x)) });
                }}
              >
                {source.columns.map((c) => <option key={c.key} value={c.key}>{tr(columnLabel(c.key))}</option>)}
              </select>
              <Button size="sm" variant="ghost" aria-label={tr('Remove')} onClick={() => set({ totals: (def.totals ?? []).filter((_, n) => n !== i) })}>✕</Button>
            </div>
          ))}
          {(def.totals ?? []).length < REPORT_LIMITS.totals && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const c = source.columns.find((x) => x.type === 'money') ?? source.columns.find((x) => x.type === 'number') ?? source.columns[0];
                if (c) set({ totals: [...(def.totals ?? []), { column: c.key, fn: reportFnsFor(c.type)[0] as ReportTotalFn }] });
              }}
            >
              {tr('Add a total')}
            </Button>
          )}
        </fieldset>

        {!grouped && (
          <fieldset className="report-panel">
            <legend>{tr('Columns')}</legend>
            <div className="report-checks">
              {source.columns.map((c) => {
                const on = (def.columns ?? []).includes(c.key);
                return (
                  <label key={c.key} className="check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => set({ columns: on ? (def.columns ?? []).filter((k) => k !== c.key) : [...(def.columns ?? []), c.key] })}
                    />
                    {tr(columnLabel(c.key))}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <fieldset className="report-panel">
          <legend>{tr('Filters')}</legend>
          {(def.filters ?? []).map((f, i) => (
            <FilterRow
              key={i}
              source={source}
              filter={f}
              onChange={(nf) => set({ filters: (def.filters ?? []).map((x, n) => (n === i ? nf : x)) })}
              onRemove={() => set({ filters: (def.filters ?? []).filter((_, n) => n !== i) })}
            />
          ))}
          {(def.filters ?? []).length < REPORT_LIMITS.filters && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const c = source.columns.find((x) => x.type === 'text') ?? source.columns[0];
                if (c) set({ filters: [...(def.filters ?? []), { column: c.key, op: reportOpsFor(c.type)[0] as ReportFilterOp, value: null }] });
              }}
            >
              {tr('Add a filter')}
            </Button>
          )}
        </fieldset>

        <fieldset className="report-panel">
          <legend>{tr('Order and chart')}</legend>
          <div className="report-row">
            <label>
              {tr('Sort by')}
              <select
                value={def.sort?.[0]?.column ?? ''}
                onChange={(e) => set({ sort: e.target.value ? [{ column: e.target.value, dir: def.sort?.[0]?.dir ?? 'desc' }] : [] })}
              >
                <option value="">{tr('Standard order')}</option>
                {outKeys.map((k) => <option key={k} value={k}>{headerLabel(k, result ?? undefined)}</option>)}
              </select>
            </label>
            {def.sort?.[0] && (
              <select aria-label={tr('Direction')} value={def.sort[0].dir} onChange={(e) => set({ sort: [{ column: def.sort?.[0]?.column as string, dir: e.target.value as 'asc' | 'desc' }] })}>
                <option value="desc">{tr('Largest or newest first')}</option>
                <option value="asc">{tr('Smallest or oldest first')}</option>
              </select>
            )}
            <label>
              {tr('Rows')}
              <input
                type="number"
                min={1}
                max={REPORT_LIMITS.rows}
                inputMode="numeric"
                placeholder={String(REPORT_LIMITS.rows)}
                value={def.limit ?? ''}
                onChange={(e) => set({ limit: e.target.value ? Math.min(REPORT_LIMITS.rows, Math.max(1, Math.trunc(Number(e.target.value)) || 1)) : null })}
              />
            </label>
          </div>
          <div className="report-row">
            <label>
              {tr('Chart')}
              <select
                value={def.chart?.type ?? ''}
                onChange={(e) => {
                  const type = e.target.value as ReportChartType | '';
                  if (!type) return set({ chart: null });
                  const x = def.chart?.x ?? outKeys.find((k) => !/^(sum|count|avg|min|max)_/.test(k) && typeOf(k) !== 'money' && typeOf(k) !== 'number') ?? outKeys[0];
                  const y = def.chart?.y ?? [...outKeys].reverse().find((k) => /^(sum|count|avg|min|max)_/.test(k) || typeOf(k) === 'money' || typeOf(k) === 'number') ?? outKeys[0];
                  if (x && y) set({ chart: { type, x, y } });
                }}
              >
                <option value="">{tr('No chart')}</option>
                {REPORT_CHART_TYPES.map((c) => <option key={c} value={c}>{tr({ bar: 'Bars', line: 'Line', pie: 'Pie' }[c])}</option>)}
              </select>
            </label>
            {def.chart && (
              <>
                <label>
                  {tr('Along')}
                  <select value={def.chart.x} onChange={(e) => set({ chart: { ...(def.chart as NonNullable<ReportDefinition['chart']>), x: e.target.value } })}>
                    {outKeys.map((k) => <option key={k} value={k}>{headerLabel(k, result ?? undefined)}</option>)}
                  </select>
                </label>
                <label>
                  {tr('Value')}
                  <select value={def.chart.y} onChange={(e) => set({ chart: { ...(def.chart as NonNullable<ReportDefinition['chart']>), y: e.target.value } })}>
                    {outKeys.map((k) => <option key={k} value={k}>{headerLabel(k, result ?? undefined)}</option>)}
                  </select>
                </label>
              </>
            )}
          </div>
        </fieldset>
      </div>

      <div className="report-actions no-print">
        <Button disabled={busy !== null} onClick={() => run(def, source)}>{busy === 'run' ? tr('Working…') : tr('Run')}</Button>
        {canCreate && (
          <Button variant="outline" disabled={busy !== null} onClick={() => setSaveOpen((o) => !o)}>
            {meta.id && canEditSaved ? tr('Save changes') : tr('Save')}
          </Button>
        )}
        <Button variant="outline" disabled={!result || busy !== null} onClick={exportExcel}>{tr('Excel')}</Button>
        <Button variant="outline" disabled={!result || busy !== null || (result?.rows.length ?? 0) > PDF_MAX_ROWS} onClick={exportPdf}>
          {busy === 'pdf' ? tr('Working…') : tr('PDF')}
        </Button>
        <Button variant="outline" disabled={!result} onClick={() => window.print()}>{tr('Print')}</Button>
        {meta.id && canEditSaved && (
          <ConfirmButton label={tr('Delete')} confirmLabel={tr('Yes, delete')} question={trf('Delete the report "{name}"?', { name: meta.name })} disabled={busy !== null} onConfirm={remove} />
        )}
        {saved && <span className="muted small">{saved}</span>}
      </div>
      {result && result.rows.length > PDF_MAX_ROWS && <p className="muted small no-print">{trf('A PDF holds up to {n} rows: use Excel for more.', { n: PDF_MAX_ROWS })}</p>}

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

      {error && <p className="error" role="alert">{error}</p>}

      {result && (
        <div ref={sheet} className="report-sheet">
          <h2 className="report-title">{meta.name || tr(sourceLabel(def.source))}</h2>
          {def.period && <p className="muted small">{trf('{from} to {to}', { from: formatDay(def.period.from, session.org), to: formatDay(def.period.to, session.org) })}</p>}
          {def.chart && <ReportChart result={result} type={def.chart.type} x={def.chart.x} y={def.chart.y} label={label} />}
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

/** One filter: column, operator and value (or values), each fitting the column's type. Money is typed in pounds, sent in minor units. */
function FilterRow({ source, filter, onChange, onRemove }: { source: ReportSource; filter: ReportFilter; onChange: (f: ReportFilter) => void; onRemove: () => void }) {
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
          <ValueInput type={type} value={pair[0] ?? null} onChange={(v) => onChange({ ...filter, value: [v ?? '', pair[1] ?? ''] as (string | number)[] })} />
          <span>{tr('and')}</span>
          <ValueInput type={type} value={pair[1] ?? null} onChange={(v) => onChange({ ...filter, value: [pair[0] ?? '', v ?? ''] as (string | number)[] })} />
        </>
      ) : filter.op === 'in' ? (
        <input
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
        <ValueInput type={type} value={(filter.value as string | number | null) ?? null} onChange={(v) => onChange({ ...filter, value: v })} />
      )}
      <Button size="sm" variant="ghost" aria-label={tr('Remove')} onClick={onRemove}>✕</Button>
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
