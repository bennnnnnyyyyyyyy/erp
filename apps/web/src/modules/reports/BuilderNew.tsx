import { useRef, useState, type ReactNode } from 'react';
import { REPORT_CHART_TYPES, REPORT_LIMITS, reportOpsFor, reportOutputKeys, type ReportDefinition, type ReportFilterOp, type ReportVisibility } from '@erp/shared';
import { DateInput } from '../../components/DateInput';
import { ConfirmButton } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { BackLink, Link } from '../../lib/router';
import { CHART_LABELS, FilterRow, PDF_MAX_ROWS, PERIOD_LABELS, filterText, measureLabel } from './Builder';
import { cellText, headerLabel } from './cells';
import { presetPeriod, tidy } from './definition';
import { columnLabel, sourceLabel } from './labels';
import { ReportAlert } from './ReportAlert';
import { ReportChart } from './ReportChart';
import { LIST, REPORT_PERIOD_PRESETS_SHOWN, parseTotal, splitChoices, totalKey, withMeasure, withSplit } from './sentence';
import { useReportBuilder } from './useReportBuilder';
import '../sales/pagekit.css';
import './reports-new.css';

// New UI (25 Nov 2026): the report builder in three versions, Design Lab "Report builder". All three start from Ben's pick (24 Nov,
// option A): one sentence "Show [what] by [split] for [period]", the report right under it, updating without a Run button. Same logic
// and API as the old page (useReportBuilder). No tiles (Bellvox: seamless, hairlines).
//   A  Sentence and command bar (Dynamics): the actions in one bar on top, the sentence, the chips, the report.
//   B  Sentence and a Refine pane: the report beside an always-open pane (only include, also show, split again, order, chart, save).
//   C  Answer first: the sentence is the page title; the totals in large figures, the chart, the table; the actions in a slim footer.
// Dead ends (Ben, 25 Nov): Back returns where you came from; an empty result says why and offers the change; "Alert me when" says what
// it needs instead of hiding; an error that a page fixes offers it (the Shell's next-step bar, lib/nextStep.ts), and a name already
// used opens the name box.
const VERSIONS = ['A', 'B', 'C'] as const;
type Panel = { kind: 'filter'; index: number } | { kind: 'also' } | { kind: 'split2' } | { kind: 'more' } | null;

export function ReportBuilderNew() {
  const version = useLabChoice('rbuild', VERSIONS, 'A');
  const b = useReportBuilder();
  const [panel, setPanel] = useState<Panel>(null);
  const [datesOpen, setDatesOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  const back = <BackLink to="/reports" label={`← ${tr('Report library')}`} backLabel={tr('← Back')} />;

  if (!b.sources.data) return <section className="page pk pk-wide rbn">{back}<Loading error={b.sources.error} /></section>;
  if (b.sources.data.length === 0) {
    return (
      <section className="page pk rbn">
        {back}
        <h1>{tr('New report')}</h1>
        <div className="rbn-why">
          <p>{tr('No data is open to you for reports yet. Ask an admin for access.')}</p>
          <p className="pk-muted">{tr('A report only shows data from the pages you can open. An owner or admin gives access in Settings → Users.')}</p>
          <Link to="/reports">{tr('Open the report library')}</Link>
        </div>
      </section>
    );
  }
  if (b.notOpen) {
    return (
      <section className="page pk rbn">
        {back}
        <div className="rbn-why">
          <p>{b.error?.message ?? tr('This ready-made report is not open to you.')}</p>
          <p className="pk-muted">{tr('It uses data from a page you cannot open. Choose another report, or start a new one.')}</p>
          <p><Link to="/reports">{tr('Open the report library')}</Link> · <Link to="/reports/new">{tr('New report')}</Link></p>
        </div>
      </section>
    );
  }
  const { def, source } = b;
  if (!def || !source) return <section className="page pk pk-wide rbn">{back}<Loading error={b.error?.message ?? null} /></section>;

  const groups = def.groupBy ?? [];
  const grouped = groups.length > 0;
  const filters = def.filters ?? [];
  const showDates = !!source.period && (b.period === 'custom' || datesOpen);
  const toggle = (p: NonNullable<Panel>) => setPanel((cur) => (cur && cur.kind === p.kind && (p.kind !== 'filter' || (cur.kind === 'filter' && cur.index === p.index)) ? null : p));
  const title = b.meta.id || b.meta.templateKey ? b.meta.name : tr('New report');
  const openSave = () => {
    setSaveOpen(true);
    setTimeout(() => nameBox.current?.focus(), 0);
  };
  const addFilter = () => {
    const c = source.columns.find((x) => x.type === 'text') ?? source.columns[0];
    if (!c) return;
    b.patch({ filters: [...filters, { column: c.key, op: reportOpsFor(c.type)[0] as ReportFilterOp, value: null }] });
    setPanel({ kind: 'filter', index: filters.length });
  };

  // ---- pieces every version uses ----
  const dataPick = (
    <label className="rbn-data">
      <span>{tr('Data')}</span>
      <select value={def.source} onChange={(e) => { b.pickSource(e.target.value); setPanel(null); }}>
        {b.sources.data.map((s) => <option key={s.key} value={s.key}>{tr(sourceLabel(s.key))}</option>)}
      </select>
    </label>
  );
  const sentence = (cls: string) => (
    <div className={`rbn-sentence ${cls}`}>
      <span>{tr('Show')}</span>
      <select aria-label={tr('What to show')} value={b.measure} onChange={(e) => b.set(withMeasure(def, e.target.value, source))}>
        {[...b.measures, ...(b.measures.includes(b.measure) ? [] : [b.measure])].map((k) => <option key={k} value={k}>{measureLabel(k)}</option>)}
      </select>
      {b.measure !== LIST && (
        <>
          <span>{tr('by')}</span>
          <select aria-label={tr('Split by')} value={b.split} onChange={(e) => b.set(withSplit(def, e.target.value, source))}>
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
            value={showDates ? 'custom' : b.period}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') {
                setDatesOpen(true);
                if (!def.period) b.patch({ period: presetPeriod('this_month') });
              } else {
                setDatesOpen(false);
                b.patch({ period: v === 'any' ? null : presetPeriod(v as (typeof REPORT_PERIOD_PRESETS_SHOWN)[number]) });
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
  );
  const dates = showDates ? (
    <div className="rbn-dates">
      <DateInput aria-label={tr('From')} value={def.period?.from ?? ''} onChange={(e) => b.patch({ period: { from: e.target.value, to: def.period?.to ?? e.target.value } })} />
      <span aria-hidden="true">–</span>
      <DateInput aria-label={tr('To')} value={def.period?.to ?? ''} onChange={(e) => b.patch({ period: { from: def.period?.from ?? e.target.value, to: e.target.value } })} />
    </div>
  ) : null;

  const filterEditor = (i: number) => {
    const f = filters[i];
    if (!f) return null;
    return (
      <FilterRow key={i} source={source} filter={f} onChange={(nf) => b.patch({ filters: filters.map((x, n) => (n === i ? nf : x)) })} />
    );
  };
  const alsoEditor = (
    <>
      {b.measure !== LIST && (def.totals ?? []).length < REPORT_LIMITS.totals && (
        <label className="rbn-field">
          <span>{tr('Add a number')}</span>
          <select value="" onChange={(e) => { const t = parseTotal(e.target.value); if (t) b.patch({ totals: [...(def.totals ?? []), t] }); }}>
            <option value="">{tr('Choose…')}</option>
            {b.moreTotals.map((k) => <option key={k} value={k}>{headerLabel(k)}</option>)}
          </select>
        </label>
      )}
      {!grouped && (
        <fieldset className="rbn-cols">
          <legend>{tr('Columns in the list')}</legend>
          {source.columns.map((c) => {
            const on = (def.columns ?? []).includes(c.key);
            return (
              <label key={c.key} className="rbn-check">
                <input type="checkbox" checked={on} onChange={() => b.patch({ columns: on ? (def.columns ?? []).filter((k) => k !== c.key) : [...(def.columns ?? []), c.key] })} />
                {tr(columnLabel(c.key))}
              </label>
            );
          })}
        </fieldset>
      )}
    </>
  );
  const split2Editor = grouped ? (
    <label className="rbn-field">
      <span>{tr('Split each row again by')}</span>
      <select value={groups[1] ?? ''} onChange={(e) => { b.patch({ groupBy: e.target.value ? [groups[0] as string, e.target.value] : groups.slice(0, 1) }); setPanel(null); }}>
        <option value="">{groups[1] ? tr('Nothing') : tr('Choose…')}</option>
        {splitChoices(source).filter((k) => k !== groups[0]).map((k) => <option key={k} value={k}>{tr(columnLabel(k))}</option>)}
      </select>
    </label>
  ) : <p className="pk-muted">{tr('Choose what to split by in the sentence first.')}</p>;
  const outKeys = reportOutputKeys(tidy(def));
  const moreEditor = (
    <div className="rbn-row">
      <label className="rbn-field">
        <span>{tr('Sort by')}</span>
        <select value={def.sort?.[0]?.column ?? ''} onChange={(e) => b.patch({ sort: e.target.value ? [{ column: e.target.value, dir: def.sort?.[0]?.dir ?? 'desc' }] : [] })}>
          <option value="">{tr('Standard order')}</option>
          {outKeys.map((k) => <option key={k} value={k}>{headerLabel(k, b.result ?? undefined)}</option>)}
        </select>
      </label>
      {def.sort?.[0] && (
        <label className="rbn-field">
          <span>{tr('Direction')}</span>
          <select value={def.sort[0].dir} onChange={(e) => b.patch({ sort: [{ column: def.sort?.[0]?.column as string, dir: e.target.value as 'asc' | 'desc' }] })}>
            <option value="desc">{tr('Largest or newest first')}</option>
            <option value="asc">{tr('Smallest or oldest first')}</option>
          </select>
        </label>
      )}
      <label className="rbn-field">
        <span>{tr('Show at most (rows)')}</span>
        <input type="number" min={1} max={REPORT_LIMITS.rows} inputMode="numeric" placeholder={String(REPORT_LIMITS.rows)} value={def.limit ?? ''}
          onChange={(e) => b.patch({ limit: e.target.value ? Math.min(REPORT_LIMITS.rows, Math.max(1, Math.trunc(Number(e.target.value)) || 1)) : null })} />
      </label>
    </div>
  );

  const chips = (
    <div className="rbn-chips">
      {filters.map((f, i) => (
        <span key={i} className="rbn-chip" data-on={panel?.kind === 'filter' && panel.index === i}>
          <button type="button" onClick={() => toggle({ kind: 'filter', index: i })}>{filterText(f, b.typeOf(f.column), b.session.org)}</button>
          <button type="button" className="rbn-x" aria-label={tr('Remove')} onClick={() => { b.patch({ filters: filters.filter((_, n) => n !== i) }); setPanel(null); }}>✕</button>
        </span>
      ))}
      {groups[1] && (
        <span className="rbn-chip">
          <span>{trf('then by {column}', { column: tr(columnLabel(groups[1])) })}</span>
          <button type="button" className="rbn-x" aria-label={tr('Remove')} onClick={() => b.patch({ groupBy: groups.slice(0, 1) })}>✕</button>
        </span>
      )}
      {(def.totals ?? []).slice(1).map((t) => (
        <span key={totalKey(t)} className="rbn-chip">
          <span>{trf('also {what}', { what: headerLabel(totalKey(t)) })}</span>
          <button type="button" className="rbn-x" aria-label={tr('Remove')}
            onClick={() => b.set(withMeasure({ ...def, totals: (def.totals ?? []).filter((x) => totalKey(x) !== totalKey(t)) }, b.measure, source))}>✕</button>
        </span>
      ))}
      {filters.length < REPORT_LIMITS.filters && <button type="button" className="rbn-chip rbn-add" onClick={addFilter}>{tr('+ Only include…')}</button>}
      <button type="button" className="rbn-chip rbn-add" aria-pressed={panel?.kind === 'also'} onClick={() => toggle({ kind: 'also' })}>{tr('+ Also show…')}</button>
      {grouped && !groups[1] && <button type="button" className="rbn-chip rbn-add" aria-pressed={panel?.kind === 'split2'} onClick={() => toggle({ kind: 'split2' })}>{tr('+ Split again by…')}</button>}
      <button type="button" className="rbn-chip rbn-add" aria-pressed={panel?.kind === 'more'} onClick={() => toggle({ kind: 'more' })}>{tr('Order and rows…')}</button>
    </div>
  );
  const openEditor = panel ? (
    <div className="rbn-editor">
      {panel.kind === 'filter' ? <><span className="pk-muted">{tr('Only include lines where')}</span>{filterEditor(panel.index)}</> : null}
      {panel.kind === 'also' ? alsoEditor : null}
      {panel.kind === 'split2' ? split2Editor : null}
      {panel.kind === 'more' ? moreEditor : null}
      <div><button type="button" className="pk-act" onClick={() => setPanel(null)}>{tr('Done')}</button></div>
    </div>
  ) : null;

  const chartChoice = grouped && def.totals?.[0] ? (
    <div className="rbn-seg" role="group" aria-label={tr('Chart')}>
      {REPORT_CHART_TYPES.map((c) => (
        <button key={c} type="button" aria-pressed={def.chart?.type === c}
          onClick={() => b.patch({ chart: { type: c, x: groups[0] as string, y: totalKey(def.totals?.[0] as NonNullable<ReportDefinition['totals']>[number]) } })}>
          {tr(CHART_LABELS[c])}
        </button>
      ))}
      <button type="button" aria-pressed={!def.chart} onClick={() => b.patch({ chart: null })}>{tr('Table only')}</button>
    </div>
  ) : null;

  const tooMany = (b.result?.rows.length ?? 0) > PDF_MAX_ROWS;
  const actions = (
    <>
      {b.canCreate && <button type="button" className="pk-act pk-act-main" disabled={b.busy !== null} onClick={() => (saveOpen ? setSaveOpen(false) : openSave())}>{b.meta.id && b.canEditSaved ? tr('Save changes') : tr('Save')}</button>}
      <button type="button" className="pk-act" disabled={!b.result || b.busy !== null} onClick={b.exportExcel}>{tr('Excel')}</button>
      <button type="button" className="pk-act" disabled={!b.result || b.busy !== null || tooMany} title={tooMany ? trf('A PDF holds up to {n} rows: use Excel for more.', { n: PDF_MAX_ROWS }) : undefined} onClick={() => void b.exportPdf(sheet.current)}>
        {b.busy === 'pdf' ? tr('Working…') : tr('PDF')}
      </button>
      <button type="button" className="pk-act" disabled={!b.result} onClick={() => window.print()}>{tr('Print')}</button>
      {b.canAlert && (
        <button type="button" className="pk-act" disabled={b.busy !== null || !!b.alertBlock} title={b.alertBlock ? tr(b.alertBlock) : undefined} onClick={() => setAlertOpen((o) => !o)}>{tr('Alert me when')}</button>
      )}
      {b.meta.id && b.canEditSaved && (
        <ConfirmButton label={tr('Delete')} confirmLabel={tr('Yes, delete')} question={trf('Delete the report "{name}"?', { name: b.meta.name })} disabled={b.busy !== null} onConfirm={b.remove} />
      )}
      {b.running && <span className="pk-muted" aria-live="polite">{tr('Working…')}</span>}
      {b.saved && <span className="pk-muted">{b.saved}</span>}
    </>
  );
  // "Alert me when" never just disappears: when it cannot be used yet, one line says what it needs.
  const alertWhy = b.canAlert && b.alertBlock && b.meta.id ? <p className="pk-muted rbn-note">{tr(b.alertBlock)}</p> : null;

  const saveForm = (
    <fieldset className="rbn-save">
      <legend>{tr('Save the report')}</legend>
      <label className="rbn-field">
        <span>{tr('Name')}</span>
        <input ref={nameBox} value={b.meta.name} maxLength={100} aria-invalid={b.error?.code === 'duplicate_name'} onChange={(e) => { b.setMeta({ ...b.meta, name: e.target.value }); if (b.error?.code === 'duplicate_name') b.setError(null); }} />
      </label>
      {b.error?.code === 'duplicate_name' && <p className="error" role="alert">{tr('You already have a report with this name. Choose another name.')}</p>}
      <label className="rbn-field">
        <span>{tr('Who sees it')}</span>
        <select value={b.meta.visibility} onChange={(e) => b.setMeta({ ...b.meta, visibility: e.target.value as ReportVisibility })}>
          <option value="private">{tr('Only me')}</option>
          {b.canManage && <option value="company">{tr('Everyone in the company who may see this data')}</option>}
        </select>
      </label>
      {!b.canManage && <p className="pk-muted">{tr('Only owners and admins save reports for the whole company.')}</p>}
      <label className="rbn-field">
        <span>{tr('Description (optional)')}</span>
        <input value={b.meta.description} maxLength={500} onChange={(e) => b.setMeta({ ...b.meta, description: e.target.value })} />
      </label>
      <div className="rbn-row">
        {b.meta.id && b.canEditSaved && (
          <button type="button" className="pk-act pk-act-main" disabled={b.busy !== null || !b.meta.name.trim()} onClick={() => void b.save(false).then((ok) => ok && setSaveOpen(false))}>{tr('Save changes')}</button>
        )}
        <button type="button" className={`pk-act${b.meta.id && b.canEditSaved ? '' : ' pk-act-main'}`} disabled={b.busy !== null || !b.meta.name.trim()} onClick={() => void b.save(true).then((ok) => ok && setSaveOpen(false))}>
          {b.meta.id ? tr('Save as a new report') : tr('Save')}
        </button>
      </div>
    </fieldset>
  );
  const alertPanel = alertOpen && b.meta.id && !b.alertBlock ? (
    <ReportAlert reportId={b.meta.id} reportName={b.meta.name} totals={def.totals ?? []} source={source}
      onClose={(message) => { setAlertOpen(false); if (message) b.setSaved(message); }} />
  ) : null;

  const notes = (
    <>
      {!b.meta.id && b.meta.templateKey && <p className="pk-muted rbn-note">{tr('A ready-made report. Change anything and save it as your own.')}</p>}
      {b.meta.id && !b.canEditSaved && <p className="pk-muted rbn-note">{tr('You can change the settings and see the result, but only save them as a new report.')}</p>}
      {b.problem && <p className="pk-muted rbn-note">{tr(b.problem)}</p>}
      {b.error && b.error.code !== 'duplicate_name' && <p className="error" role="alert">{b.error.message}</p>}
    </>
  );

  // The table and totals. An empty result says why and offers the change that fills it (dead ends).
  const r = b.result;
  const curIdx = r?.columns.findIndex((c) => c.type === 'currency') ?? -1;
  const label = (raw: unknown, key: string) => cellText((raw ?? null) as string | number | null, r?.columns.find((c) => c.key === key)?.type ?? 'text', key, b.session.org?.defaultCurrency ?? null, b.session.org);
  const why = r && r.rows.length === 0 ? (
    <div className="rbn-why">
      <p>{tr('No rows match.')}</p>
      {filters.length > 0 && <p>{tr('Your "Only include" choices leave nothing.')} <button type="button" className="pk-link" onClick={() => b.patch({ filters: [] })}>{tr('Remove them')}</button></p>}
      {def.period && b.period !== 'last_12_months' && <p>{tr('Nothing was recorded in this period.')} <button type="button" className="pk-link" onClick={b.widen}>{tr('Look at the last 12 months')}</button></p>}
      {filters.length === 0 && (!def.period || b.period === 'last_12_months') && <p className="pk-muted">{tr('Nothing has been recorded for this data yet. It fills as the company works.')}</p>}
    </div>
  ) : null;
  const table = r ? (
    <>
      {r.rows.length > 0 && (
        <div className="pk-table-wrap">
          <table className="pk-table">
            <thead><tr>{r.columns.map((c) => <th key={c.key} scope="col" className={c.type === 'money' || c.type === 'number' ? 'pk-num' : undefined}>{c.type === 'currency' ? tr('Currency') : headerLabel(c.key, r)}</th>)}</tr></thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((v, j) => {
                    const col = r.columns[j];
                    const cur = curIdx >= 0 ? (row[curIdx] as string | null) : (b.session.org?.defaultCurrency ?? null);
                    return <td key={j} className={col?.type === 'money' || col?.type === 'number' ? 'pk-num' : undefined}>{cellText(v, col?.type ?? 'text', col?.key ?? '', cur, b.session.org)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {why}
      {r.truncated && <p className="pk-muted">{trf('Showing the first {n} rows. Narrow the period or add a filter to see the rest.', { n: r.rows.length })}</p>}
    </>
  ) : null;
  const totalsTable = r && r.totals.length > 0 && r.totalRows.length > 0 && r.rows.length > 0 ? (
    <div className="pk-table-wrap">
      <table className="pk-table rbn-totals">
        <thead><tr><th scope="col">{tr('Totals')}</th>{r.totals.map((t) => <th key={t.key} scope="col" className="pk-num">{headerLabel(t.key, r)}</th>)}</tr></thead>
        <tbody>
          {r.totalRows.map((line) => (
            <tr key={line.currency ?? 'all'}>
              <td>{line.currency ?? tr('All rows')}</td>
              {line.values.map((v, i) => <td key={i} className="pk-num"><strong>{cellText(v, r.totals[i]?.type ?? 'number', r.totals[i]?.column ?? '', line.currency ?? b.session.org?.defaultCurrency ?? null, b.session.org)}</strong></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : null;
  const periodLine = def.period ? <p className="pk-muted">{trf('{from} to {to}', { from: formatDay(def.period.from, b.session.org), to: formatDay(def.period.to, b.session.org) })}</p> : null;
  const chart = r && def.chart && grouped && r.rows.length > 0 ? <ReportChart result={r} type={def.chart.type} x={def.chart.x} y={def.chart.y} label={label} /> : null;
  const sheetOf = (top: ReactNode, inner: ReactNode) => (
    <div ref={sheet} className="rbn-sheet" aria-busy={b.running}>
      <h2 className="rbn-print-title">{b.meta.name || tr(sourceLabel(def.source))}</h2>
      {top}
      {inner}
    </div>
  );

  // ---- B: Refine pane ----
  if (version === 'B') {
    return (
      <section className="page pk pk-wide rbn rbn-b">
        <p className="no-print">{back}</p>
        <div className="pk-head"><div><p className="pk-kind">{tr('Report')}</p><h1>{title}</h1></div><div className="rbn-actions no-print">{actions}</div></div>
        {b.meta.description && <p className="pk-muted">{b.meta.description}</p>}
        <div className="no-print">{dataPick}{sentence('rbn-sentence-b')}{dates}</div>
        {notes}{alertWhy}{alertPanel}
        <div className="rbn-split">
          <div className="rbn-main">
            {r ? sheetOf(<>{periodLine}{chart}</>, <>{totalsTable}{table}</>) : <Loading />}
          </div>
          <aside className="rbn-pane no-print" aria-label={tr('Refine')}>
            <h2 className="rbn-pane-h">{tr('Refine')}</h2>
            <section>
              <h3>{tr('Only include')}</h3>
              {filters.length === 0 && <p className="pk-muted">{tr('Every line is included.')}</p>}
              {filters.map((_, i) => (
                <div key={i} className="rbn-pane-filter">
                  {filterEditor(i)}
                  <button type="button" className="pk-link" onClick={() => b.patch({ filters: filters.filter((__, n) => n !== i) })}>{tr('Remove')}</button>
                </div>
              ))}
              {filters.length < REPORT_LIMITS.filters && <button type="button" className="pk-link" onClick={addFilter}>{tr('+ Only include…')}</button>}
            </section>
            <section><h3>{tr('Also show')}</h3>{alsoEditor}</section>
            <section><h3>{tr('Split again')}</h3>{split2Editor}</section>
            <section><h3>{tr('Order and rows')}</h3>{moreEditor}</section>
            {chartChoice && <section><h3>{tr('Chart')}</h3>{chartChoice}</section>}
            {b.canCreate && saveOpen && <section>{saveForm}</section>}
          </aside>
        </div>
      </section>
    );
  }

  // ---- C: answer first ----
  if (version === 'C') {
    const figures = r && r.totals.length > 0 && r.rows.length > 0 ? (
      <div className="pk-strip rbn-figures">
        {r.totalRows.flatMap((line) => line.values.map((v, i) => (
          <div key={`${line.currency}-${i}`}>
            <span>{headerLabel(r.totals[i]?.key ?? '', r)}{line.currency ? ` · ${line.currency}` : ''}</span>
            <strong>{cellText(v, r.totals[i]?.type ?? 'number', r.totals[i]?.column ?? '', line.currency ?? b.session.org?.defaultCurrency ?? null, b.session.org)}</strong>
          </div>
        )))}
      </div>
    ) : null;
    return (
      <section className="page pk pk-wide rbn rbn-c">
        <p className="no-print rbn-c-top">{back}<span className="pk-bar-gap" />{dataPick}</p>
        {(b.meta.id || b.meta.templateKey) && <p className="pk-kind">{b.meta.name}</p>}
        <div className="rbn-c-title no-print" role="heading" aria-level={1}>{sentence('rbn-sentence-c')}</div>
        {dates}
        <div className="no-print">{chips}{openEditor}</div>
        {notes}{alertWhy}
        {r ? sheetOf(<>{periodLine}{figures}{chartChoice ? <div className="no-print">{chartChoice}</div> : null}{chart}</>, table) : <Loading />}
        {b.canCreate && saveOpen && saveForm}
        {alertPanel}
        <div className="rbn-footer no-print">{actions}</div>
      </section>
    );
  }

  // ---- A: sentence and command bar (Dynamics) ----
  return (
    <section className="page pk pk-wide rbn rbn-a">
      <p className="no-print">{back}</p>
      <div className="pk-head"><div><p className="pk-kind">{tr('Report')}</p><h1>{title}</h1></div></div>
      <div className="pk-bar rbn-bar no-print" role="toolbar" aria-label={tr('Actions')}>{actions}</div>
      {b.meta.description && <p className="pk-muted">{b.meta.description}</p>}
      {b.canCreate && saveOpen && saveForm}
      {alertPanel}
      <div className="rbn-build no-print">
        {dataPick}
        {sentence('rbn-sentence-a')}
        {dates}
        {chips}
        {openEditor}
      </div>
      {notes}{alertWhy}
      {chartChoice ? <div className="no-print rbn-chartbar">{chartChoice}</div> : null}
      {r ? sheetOf(<>{periodLine}{chart}</>, <>{table}{totalsTable}</>) : <Loading />}
    </section>
  );
}
