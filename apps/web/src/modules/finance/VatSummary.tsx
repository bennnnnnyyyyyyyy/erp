import { DateInput } from '../../components/DateInput';
import { useState } from 'react';
import { formatMoney, type VatSummary } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api, apiDownload } from '../../lib/api';
import { todayIn } from '../../lib/dates';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { hasPermission } from '@erp/shared';
import { VatReturnPanel } from './VatReturnPanel';

// VAT summary (sql/089, documentation/plans/VAT_PLAN.md part 3): output VAT on sales (by rate, zero-rated exports, exempt; net of
// approved credit and debit notes), deductible input VAT on purchases (local, capital assets, imports), and the VAT due or the credit
// to carry forward. Each section opens the documents behind it. The section names are ours until the accountant gives the return's
// (Form 10) headings. Owners and admins.

const WARNING: Record<VatSummary['warnings'][number], string> = {
  not_registered: 'The company is not VAT registered: this shows the VAT on the documents, not a return.',
  before_vat_from: 'The period starts before the company became VAT registered: documents before that carry no VAT.',
  partial_deduction:
    'This period has both taxable and exempt sales. Input VAT should then be shared between them; that is not done yet, so the deductible VAT shown may be too high. Ask your accountant.',
  other_currency: 'Some documents are in another currency and are not included.',
  excludes_supplier_credit_notes: 'Supplier credit notes are not included (they cannot be recorded yet).',
};
const SALES_KIND: Record<string, string> = { taxable: 'Taxable sales', zero_rated: 'Zero-rated sales (exports)', exempt: 'Exempt sales (no VAT)' };
const PURCHASE_KIND: Record<string, string> = { local: 'Goods and services', capital: 'Capital assets (equipment, machinery)', import: 'Imports (customs)' };
const DOC_LINK: Record<string, (id: string) => string | null> = {
  customer_invoice: (id) => `/sales/invoices/${id}`,
  supplier_invoice: (id) => `/purchasing/invoices/${id}`,
  expense: (id) => `/finance/expenses/${id}`,
  sales_note: () => null,
};
const DOC_TYPE: Record<string, string> = { customer_invoice: 'Sales invoice', sales_note: 'Credit or debit note', supplier_invoice: 'Purchase invoice', expense: 'Expense' };

export function monthOf(day: string) {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}
export { WARNING as VAT_WARNING, SALES_KIND, PURCHASE_KIND, DOC_LINK, DOC_TYPE };

/** The VAT summary's logic, shared by the old page and the new-UI "VAT month" versions (VatMonthNew). */
export function useVatSummary() {
  const session = useSession();
  const [range, setRange] = useState(() => monthOf(todayIn()));
  const [shown, setShown] = useState(range);
  const [section, setSection] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const data = useLoad(() => api<VatSummary>(`/v1/finance/vat-summary?from=${shown.from}&to=${shown.to}`));
  const s = data.data;
  const cur = s?.currency ?? session.org?.defaultCurrency ?? 'EGP';
  const money = (v: number) => formatMoney({ amountMinor: v, currency: cur });
  const key = (side: string, kind: string, rate: number) => `${side}:${kind}:${side === 'sales' && kind === 'taxable' ? rate : 0}`;
  const docs = (s?.documents ?? []).filter((d) => !section || key(d.side, d.kind, d.rate) === section);
  const pick = (k: string) => setSection(section === k ? null : k);
  // closing (part 4) works on whole calendar months only
  const wholeMonth = shown.from.endsWith('-01') && monthOf(shown.from).to === shown.to;
  /** Show another period; with a day, the whole calendar month that holds it. */
  const show = (next?: { from: string; to: string }) => {
    const r = next ?? range;
    setRange(r);
    setShown(r);
    setSection(null);
    data.reload();
  };
  const download = async () => {
    try {
      await apiDownload(`/v1/finance/vat-summary?from=${shown.from}&to=${shown.to}&format=csv`, `vat-summary-${shown.from}-to-${shown.to}.csv`);
      setMessage(tr('Downloaded.'));
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const canClose = wholeMonth && Boolean(s?.vatRegistered) && session.modules.includes('accounting') && hasPermission(session.permissions, 'accounting.ledger.view');
  return { range, setRange, shown, setShown, section, setSection, message, setMessage, data, s, cur, money, key, docs, pick, wholeMonth, show, download, canClose };
}

export function VatSummaryPage() {
  const session = useSession();
  const { range, setRange, shown, setShown, section, setSection, message, setMessage, data, s, money, key, docs, pick, wholeMonth } = useVatSummary();

  return (
    <section className="page wide">
      <h1>{tr('VAT summary')}</h1>
      <p className="muted">
        {tr('VAT on sales less the VAT you can deduct on purchases, for a period, laid out like the VAT return. Click a line to see its documents.')}
      </p>
      <div className="form-row">
        <label>
          {tr('From')}
          <DateInput value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </label>
        <label>
          {tr('To')}
          <DateInput value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </label>
        <Button variant="outline" disabled={!range.from || !range.to || range.to < range.from} onClick={() => { setShown(range); setSection(null); data.reload(); }}>
          {tr('Show')}
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              await apiDownload(`/v1/finance/vat-summary?from=${shown.from}&to=${shown.to}&format=csv`, `vat-summary-${shown.from}-to-${shown.to}.csv`);
              setMessage(tr('Downloaded.'));
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          {tr('Download CSV')}
        </Button>
        <Button variant="ghost" onClick={() => window.print()}>
          {tr('Print')}
        </Button>
      </div>
      {message ? <p className="muted small">{message}</p> : null}
      {!s ? (
        <Loading error={data.error} />
      ) : (
        <>
          <p className="muted small">
            {trf('{from} to {to}, in {currency}.', { from: formatDay(s.from, session.org), to: formatDay(s.to, session.org), currency: s.currency })}{' '}
            {s.vatRegistered && s.vatFrom ? trf('VAT registered from {date}.', { date: formatDay(s.vatFrom, session.org) }) : null}
          </p>
          {s.warnings.map((w) => (
            <p key={w} className={w === 'partial_deduction' || w === 'before_vat_from' ? 'error notice' : 'notice'}>
              {tr(WARNING[w])}
              {w === 'other_currency' ? ` (${s.otherCurrencyDocuments})` : ''}
            </p>
          ))}

          <h2 className="related">{tr('Sales (output VAT)')}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{tr('Section')}</th>
                  <th scope="col" className="right">{tr('Invoices')}</th>
                  <th scope="col" className="right">{tr('Credit and debit notes')}</th>
                  <th scope="col" className="right">{tr('Before VAT')}</th>
                  <th scope="col" className="right">{tr('VAT')}</th>
                </tr>
              </thead>
              <tbody>
                {s.sales.map((r) => {
                  const k = key('sales', r.kind, r.rate);
                  return (
                    <tr key={k} className={section === k ? 'selected' : undefined} onClick={() => pick(k)} style={{ cursor: 'pointer' }}>
                      <td>{r.kind === 'taxable' ? trf('Taxable sales at {rate}%', { rate: r.rate }) : tr(SALES_KIND[r.kind] ?? r.kind)}</td>
                      <td className="right">{money(r.invoicesNetMinor)}</td>
                      <td className="right">{money(r.notesNetMinor)}</td>
                      <td className="right">{money(r.netMinor)}</td>
                      <td className="right">{money(r.taxMinor)}</td>
                    </tr>
                  );
                })}
                {!s.sales.length ? <tr><td colSpan={5} className="muted empty">{tr('No sales in this period.')}</td></tr> : null}
                <tr>
                  <td colSpan={4} className="right"><strong>{tr('Output VAT')}</strong></td>
                  <td className="right"><strong>{money(s.outputTaxMinor)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 className="related">{tr('Purchases (input VAT)')}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{tr('Section')}</th>
                  <th scope="col" className="right">{tr('Before VAT')}</th>
                  <th scope="col" className="right">{tr('VAT deducted')}</th>
                  <th scope="col" className="right">{tr('VAT not deductible (in the cost)')}</th>
                </tr>
              </thead>
              <tbody>
                {s.purchases.map((r) => {
                  const k = key('purchases', r.kind, 0);
                  return (
                    <tr key={k} className={section === k ? 'selected' : undefined} onClick={() => pick(k)} style={{ cursor: 'pointer' }}>
                      <td>{tr(PURCHASE_KIND[r.kind] ?? r.kind)}</td>
                      <td className="right">{money(r.netMinor)}</td>
                      <td className="right">{money(r.deductibleTaxMinor)}</td>
                      <td className="right">{money(r.nonDeductibleTaxMinor)}</td>
                    </tr>
                  );
                })}
                {!s.purchases.length ? <tr><td colSpan={4} className="muted empty">{tr('No purchases in this period.')}</td></tr> : null}
                <tr>
                  <td colSpan={2} className="right"><strong>{tr('Input VAT deducted')}</strong></td>
                  <td className="right"><strong>{money(s.inputTaxMinor)}</strong></td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          <dl className="facts">
            <div><dt>{tr('Output VAT')}</dt><dd className="amount">{money(s.outputTaxMinor)}</dd></div>
            <div><dt>{tr('Input VAT deducted')}</dt><dd className="amount">{s.inputTaxMinor > 0 ? '−' : ''}{money(s.inputTaxMinor)}</dd></div>
            <div>
              <dt>{s.dueMinor >= 0 ? tr('VAT due') : tr('VAT credit to carry forward')}</dt>
              <dd className="amount"><strong>{money(Math.abs(s.dueMinor))}</strong></dd>
            </div>
          </dl>

          {wholeMonth && s.vatRegistered && session.modules.includes('accounting') && hasPermission(session.permissions, 'accounting.ledger.view') ? (
            <VatReturnPanel key={shown.from} month={shown.from} />
          ) : null}

          <div className="section-head">
            <h2 className="related">
              {tr('Documents')} <span className="muted small">({docs.length})</span>
            </h2>
            {section ? <Button variant="ghost" size="sm" onClick={() => setSection(null)}>{tr('Show all')}</Button> : null}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{tr('Date')}</th>
                  <th scope="col">{tr('Document')}</th>
                  <th scope="col">{tr('Type')}</th>
                  <th scope="col" className="right">{tr('Before VAT')}</th>
                  <th scope="col" className="right">{tr('VAT')}</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const href = DOC_LINK[d.type]?.(d.id) ?? null;
                  return (
                    <tr key={`${d.type}:${d.id}:${d.kind}:${d.rate}`}>
                      <td className="nowrap">{formatDay(d.date, session.org)}</td>
                      <td>{href ? <Link to={href}><code>{d.number}</code></Link> : <code>{d.number}</code>}</td>
                      <td>{tr(DOC_TYPE[d.type] ?? d.type)}</td>
                      <td className="right">{money(d.netMinor)}</td>
                      <td className="right">{money(d.taxMinor + d.nonDeductibleTaxMinor)}</td>
                    </tr>
                  );
                })}
                {!docs.length ? <tr><td colSpan={5} className="muted empty">{tr('No documents.')}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
