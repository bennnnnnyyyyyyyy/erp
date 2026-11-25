import { SALES_FORECAST_HORIZONS, hasPermission, type SalesForecastBy, type SalesForecastHorizon, type SalesForecastRow } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { BackLink, Link } from '../../lib/router';
import { formatQty } from '../../lib/numbers';
import { useSession } from '../../session';
import { TREND, TREND_MARK, money, nameOf, useSalesForecast } from './SalesForecast';
import '../sales/pagekit.css';
import './reports-new.css';

// New UI (24 Nov 2026): the sales forecast in three versions, Design Lab "Sales forecast". Same numbers as the old page
// (useSalesForecast); every number comes from the database, this screen only shows them.
//   A  Dynamics report: the two choices as chips, a figures strip (forecast and last 30 days per currency, going up, going down), the table.
//   B  Read first: what to expect in plain sentences, what is going up and down, then the table.
//   C  Chart first: for each product or customer, last 30 days against the forecast as two bars; the table folds below.
const VERSIONS = ['A', 'B', 'C'] as const;

export function SalesForecastNew() {
  const version = useLabChoice('rfc', VERSIONS, 'A');
  const session = useSession();
  const { by, horizon, data, change, items, exportExcel } = useSalesForecast();
  const f = data.data;

  const choices = (
    <div className="pk-bar" role="toolbar" aria-label={tr('Filters')}>
      <label className="rp-chip"><span>{tr('By')}</span>
        <select value={by} onChange={(e) => change(e.target.value as SalesForecastBy, horizon)}>
          <option value="item">{tr('Product')}</option><option value="customer">{tr('Customer')}</option>
        </select>
      </label>
      <label className="rp-chip"><span>{tr('Forecast for')}</span>
        <select value={horizon} onChange={(e) => change(by, Number(e.target.value) as SalesForecastHorizon)}>
          {SALES_FORECAST_HORIZONS.map((h) => <option key={h} value={h}>{trf('the next {n} days', { n: h })}</option>)}
        </select>
      </label>
      <span className="pk-bar-gap" />
      {f ? <span className="pk-muted">{trf('Worked out on {date}.', { date: formatDay(f.asOf, session.org) })}</span> : null}
      <button type="button" className="pk-act" disabled={!f || f.rows.length === 0} onClick={exportExcel}>{tr('Excel')}</button>
      <button type="button" className="pk-act" disabled={!f} onClick={() => window.print()}>{tr('Print')}</button>
    </div>
  );
  // Dead ends (Ben, 25 Nov): Back returns where you came from (the library, a report, the bell); opened from outside, it opens the library.
  const head = (
    <>
      <p className="no-print"><BackLink to="/reports" label={`← ${tr('Report library')}`} backLabel={tr('← Back')} /></p>
      <div className="pk-head"><div><p className="pk-kind">{tr('Report')}</p><h1>{tr('Sales forecast')}</h1></div></div>
    </>
  );
  // An empty forecast says why and links to the invoices that fill it, when the person may open them.
  const noSales = (
    <>
      {tr('No sales in the last 90 days, so there is nothing to forecast yet.')}{' '}
      {hasPermission(session.permissions, 'sales.invoices.read') ? <Link to="/sales/invoices" className="pk-link">{tr('Open sales invoices')}</Link> : null}
    </>
  );
  const how = (
    <details className="pk-fold">
      <summary>{tr('How this is worked out')}</summary>
      <ul className="rf-how">
        <li>{tr('Sales are the issued invoices of the last 90 days, without VAT, minus approved credit notes.')}</li>
        <li>{tr('Sales per day: the latest 30 days count 50%, the 30 days before 30%, and the 30 days before that 20%.')}</li>
        <li>{tr('The forecast is sales per day times the number of days. Each currency is shown on its own line.')}</li>
        <li>{tr('Trend: up or down when the latest 30 days differ by more than 10% from the oldest 30 days.')}</li>
        <li>{tr('Good: at least 8 invoices over at least 60 days. Thin: less history, so treat the number as a guess.')}</li>
        <li>{tr('Seasons, price changes and promotions are not taken into account.')}</li>
      </ul>
    </details>
  );
  if (!f) return <section className="page pk pk-wide rf">{head}{choices}<Loading error={data.error} /></section>;

  // totals per currency
  const totals = new Map<string, { last: number; next: number }>();
  for (const r of f.rows) for (const v of r.values) { const t = totals.get(v.currency) ?? { last: 0, next: 0 }; t.last += v.last30Minor; t.next += v.forecastMinor; totals.set(v.currency, t); }
  const up = f.rows.filter((r) => r.trend === 'up');
  const down = f.rows.filter((r) => r.trend === 'down');
  const thin = f.rows.filter((r) => r.confidence === 'thin');
  const trendCell = (r: SalesForecastRow) => <span className={`rf-trend ${r.trend}`}><span aria-hidden="true">{TREND_MARK[r.trend]}</span> {tr(TREND[r.trend])}</span>;
  const table = (
    <div className="pk-table-wrap">
      <table className="pk-table">
        <thead><tr>
          <th scope="col">{tr(items ? 'Product' : 'Customer')}</th>
          {items ? <><th scope="col" className="pk-num">{tr('Sold in the last 30 days')}</th><th scope="col" className="pk-num">{trf('Forecast: next {n} days', { n: f.horizon })}</th></> : null}
          <th scope="col" className="pk-num">{tr('Sales in the last 30 days')}</th>
          <th scope="col" className="pk-num">{trf('Forecast value: next {n} days', { n: f.horizon })}</th>
          <th scope="col">{tr('Trend')}</th><th scope="col">{tr('Confidence')}</th>
        </tr></thead>
        <tbody>
          {f.rows.map((r) => (
            <tr key={r.id}>
              <td>{nameOf(r)} {r.code ? <span className="pk-muted"><bdi>{r.code}</bdi></span> : null}</td>
              {items ? <><td className="pk-num">{formatQty(r.qtyLast30)} {r.uom}</td><td className="pk-num"><strong>{formatQty(r.forecastQty)}</strong> {r.uom}</td></> : null}
              <td className="pk-num">{r.values.map((v) => <div key={v.currency}>{money(v.last30Minor, v.currency)}</div>)}</td>
              <td className="pk-num">{r.values.map((v) => <div key={v.currency}><strong>{money(v.forecastMinor, v.currency)}</strong></div>)}</td>
              <td>{trendCell(r)}</td>
              <td className={r.confidence === 'good' ? undefined : 'pk-muted-cell'}>{tr(r.confidence === 'good' ? 'Good' : 'Thin: a guess')}</td>
            </tr>
          ))}
          {f.rows.length === 0 ? <tr><td colSpan={items ? 7 : 5} className="pk-empty">{noSales}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );

  if (version === 'B') {
    const names = (rs: SalesForecastRow[]) => rs.slice(0, 5).map(nameOf).join(', ') + (rs.length > 5 ? trf(' and {n} more', { n: rs.length - 5 }) : '');
    return (
      <section className="page pk pk-wide rf">
        {head}{choices}
        <div className="rp-read">
          {[...totals].map(([cur, t]) => (
            <p key={cur}>{trf('In the next {n} days you are likely to sell about {next}. In the last 30 days you sold {last}.', { n: f.horizon, next: money(t.next, cur), last: money(t.last, cur) })}</p>
          ))}
          {!f.rows.length ? <p>{noSales}</p> : null}
          {up.length ? <p><span className="rf-trend up">▲</span> {trf('Going up: {names}.', { names: names(up) })}</p> : null}
          {down.length ? <p><span className="rf-trend down">▼</span> {trf('Going down: {names}.', { names: names(down) })}</p> : null}
          {thin.length ? <p className="pk-muted">{trf('{n} of them have little history, so their number is a guess.', { n: thin.length })}</p> : null}
        </div>
        <h2 className="pk-h2">{tr(items ? 'Every product' : 'Every customer')}</h2>
        {table}
        {how}
      </section>
    );
  }

  if (version === 'C') {
    const first = (r: SalesForecastRow) => r.values[0];
    const scale = Math.max(1, ...f.rows.map((r) => Math.max(first(r)?.last30Minor ?? 0, (first(r)?.forecastMinor ?? 0) * (30 / f.horizon))));
    return (
      <section className="page pk pk-wide rf">
        {head}{choices}
        <div className="rp-legend"><span className="rp-key rf-key-last" />{tr('Last 30 days')}<span className="rp-key rf-key-next" />{trf('Forecast, per 30 days of the next {n}', { n: f.horizon })}</div>
        <ul className="rp-bars rf-bars">
          {f.rows.map((r) => {
            const v = first(r);
            const last = v?.last30Minor ?? 0;
            const next30 = (v?.forecastMinor ?? 0) * (30 / f.horizon);
            return (
              <li key={r.id} className={r.confidence === 'thin' ? 'rf-thin' : undefined}>
                <span className="rp-bar-name">{nameOf(r)} {trendCell(r)}</span>
                <span className="rf-pair" aria-hidden="true">
                  <span className="rp-track"><i className="rf-last" style={{ width: `${(last / scale) * 100}%` }} /></span>
                  <span className="rp-track"><i className="rf-next" style={{ width: `${(next30 / scale) * 100}%` }} /></span>
                </span>
                <span className="pk-num rp-bar-n">{v ? money(v.forecastMinor, v.currency) : ''}{r.confidence === 'thin' ? <span className="pk-muted"> · {tr('a guess')}</span> : null}</span>
              </li>
            );
          })}
        </ul>
        <details className="pk-fold"><summary>{tr('Show the table')}</summary>{table}</details>
        {how}
      </section>
    );
  }

  // A
  return (
    <section className="page pk pk-wide rf">
      {head}{choices}
      <div className="pk-strip">
        {[...totals].map(([cur, t]) => (
          <div key={cur}><span>{trf('Forecast: next {n} days', { n: f.horizon })} · {cur}</span><strong>{money(t.next, cur)}</strong></div>
        ))}
        {[...totals].map(([cur, t]) => (
          <div key={`l${cur}`}><span>{tr('Sales in the last 30 days')} · {cur}</span><strong>{money(t.last, cur)}</strong></div>
        ))}
        <div><span>{tr('Going up')}</span><strong className="rf-trend up">▲ {up.length}</strong></div>
        <div><span>{tr('Going down')}</span><strong className="rf-trend down">▼ {down.length}</strong></div>
      </div>
      {table}
      {how}
    </section>
  );
}
