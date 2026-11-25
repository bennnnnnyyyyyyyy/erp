import { useState } from 'react';
import { SALES_FORECAST_HORIZONS, formatMoney, type SalesForecast, type SalesForecastBy, type SalesForecastHorizon, type SalesForecastRow } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { MoreMenu } from '../../components/MoreMenu';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { currentLanguage, tr, trf } from '../../lib/i18n';
import { formatQty } from '../../lib/numbers';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { saveBlob } from '../sales/print/pdf';
import { XLSX_TYPE, xlsxBytes } from './xlsx';

// Reports & Insights, step 4 (REPORTS_INSIGHTS_PLAN.md section 7.4, sql/110): the sales forecast, by product or by customer, for the
// whole company. Every number comes from the database; this screen only shows them and says how they were made.

const TREND: Record<SalesForecastRow['trend'], string> = { up: 'Up', down: 'Down', flat: 'Steady' };
const TREND_MARK: Record<SalesForecastRow['trend'], string> = { up: '▲', down: '▼', flat: '■' };

const money = (minor: number, currency: string) => formatMoney({ amountMinor: Math.round(minor), currency });
const nameOf = (r: SalesForecastRow) => (currentLanguage() === 'ar' && r.nameAr ? r.nameAr : r.name);

export function SalesForecastPage() {
  const session = useSession();
  const [by, setBy] = useState<SalesForecastBy>('item');
  const [horizon, setHorizon] = useState<SalesForecastHorizon>(30);
  const data = useLoad(() => api<SalesForecast>(`/v1/reports/forecast/sales?by=${by}&horizon=${horizon}`));
  const change = (b: SalesForecastBy, h: SalesForecastHorizon) => {
    setBy(b);
    setHorizon(h);
    // The new choice and the reload are one render, so the reload asks with the new values.
    data.reload();
  };
  const items = by === 'item';

  function exportExcel() {
    const f = data.data;
    if (!f) return;
    const header = [
      tr(items ? 'Product' : 'Customer'),
      tr('Code'),
      ...(items ? [tr('Sold in the last 30 days'), trf('Forecast: next {n} days', { n: f.horizon })] : []),
      tr('Currency'),
      tr('Sales in the last 30 days'),
      trf('Forecast value: next {n} days', { n: f.horizon }),
      tr('Trend'),
      tr('Confidence'),
      tr('Invoices'),
    ];
    const rows = f.rows.flatMap((r) =>
      r.values.map((v) => [
        nameOf(r),
        r.code,
        ...(items ? [r.qtyLast30, r.forecastQty] : []),
        v.currency,
        v.last30Minor / 100,
        v.forecastMinor / 100,
        tr(TREND[r.trend]),
        tr(r.confidence === 'good' ? 'Good' : 'Thin: a guess'),
        r.invoices,
      ]),
    );
    saveBlob(new Blob([xlsxBytes(tr('Sales forecast'), header, rows, currentLanguage() === 'ar') as BlobPart], { type: XLSX_TYPE }), 'sales-forecast.xlsx');
  }

  return (
    <section className="page wide">
      {/* Declutter (Ben, 25 Nov 2026): the title with a "More" menu, and the two choices as one sentence, as in the report builder. */}
      <div className="rb-head">
        <div className="rb-title">
          <h1>{tr('Sales forecast')}</h1>
          <p className="muted">{tr('What you are likely to sell next, from your own sales of the last 90 days.')}</p>
        </div>
        <div className="rb-head-actions no-print">
          <MoreMenu
            label={tr('More')}
            items={[
              { label: tr('Excel'), onClick: exportExcel, disabled: !data.data || data.data.rows.length === 0 },
              { label: tr('Print'), onClick: () => window.print(), disabled: !data.data },
            ]}
          />
        </div>
      </div>
      <div className="rb-sentence no-print" style={{ marginBlock: '0.75rem' }}>
        <span>{tr('Forecast sales by')}</span>
        <select aria-label={tr('By')} value={by} onChange={(e) => change(e.target.value as SalesForecastBy, horizon)}>
          <option value="item">{tr('Product')}</option>
          <option value="customer">{tr('Customer')}</option>
        </select>
        <span>{tr('for')}</span>
        <select aria-label={tr('Forecast for')} value={horizon} onChange={(e) => change(by, Number(e.target.value) as SalesForecastHorizon)}>
          {SALES_FORECAST_HORIZONS.map((h) => <option key={h} value={h}>{trf('the next {n} days', { n: h })}</option>)}
        </select>
      </div>

      {!data.data ? (
        <Loading error={data.error} />
      ) : (
        <>
          <p className="muted small">{trf('Worked out on {date}.', { date: formatDay(data.data.asOf, session.org) })}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{tr(items ? 'Product' : 'Customer')}</th>
                  {items && <th scope="col" className="right">{tr('Sold in the last 30 days')}</th>}
                  {items && <th scope="col" className="right">{trf('Forecast: next {n} days', { n: data.data.horizon })}</th>}
                  <th scope="col" className="right">{tr('Sales in the last 30 days')}</th>
                  <th scope="col" className="right">{trf('Forecast value: next {n} days', { n: data.data.horizon })}</th>
                  <th scope="col">{tr('Trend')}</th>
                  <th scope="col">{tr('Confidence')}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {nameOf(r)} {r.code && <span className="muted small"><bdi>{r.code}</bdi></span>}
                    </td>
                    {items && <td className="right">{formatQty(r.qtyLast30)} {r.uom}</td>}
                    {items && <td className="right"><b>{formatQty(r.forecastQty)}</b> {r.uom}</td>}
                    <td className="right">{r.values.map((v) => <div key={v.currency}>{money(v.last30Minor, v.currency)}</div>)}</td>
                    <td className="right">{r.values.map((v) => <div key={v.currency}><b>{money(v.forecastMinor, v.currency)}</b></div>)}</td>
                    <td><span aria-hidden="true">{TREND_MARK[r.trend]}</span> {tr(TREND[r.trend])}</td>
                    <td className={r.confidence === 'good' ? undefined : 'muted'}>{tr(r.confidence === 'good' ? 'Good' : 'Thin: a guess')}</td>
                  </tr>
                ))}
                {data.data.rows.length === 0 && (
                  <tr><td colSpan={items ? 7 : 5} className="muted empty">{tr('No sales in the last 90 days, so there is nothing to forecast yet.')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <details className="muted small">
            <summary>{tr('How this is worked out')}</summary>
            <ul>
              <li>{tr('Sales are the issued invoices of the last 90 days, without VAT, minus approved credit notes.')}</li>
              <li>{tr('Sales per day: the latest 30 days count 50%, the 30 days before 30%, and the 30 days before that 20%.')}</li>
              <li>{tr('The forecast is sales per day times the number of days. Each currency is shown on its own line.')}</li>
              <li>{tr('Trend: up or down when the latest 30 days differ by more than 10% from the oldest 30 days.')}</li>
              <li>{tr('Good: at least 8 invoices over at least 60 days. Thin: less history, so treat the number as a guess.')}</li>
              <li>{tr('Seasons, price changes and promotions are not taken into account.')}</li>
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
