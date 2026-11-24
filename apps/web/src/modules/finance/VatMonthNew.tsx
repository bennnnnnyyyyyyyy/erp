import { useState } from 'react';
import { DateInput } from '../../components/DateInput';
import { Loading } from '../../components/Loading';
import { todayIn } from '../../lib/dates';
import { formatDay } from '../../lib/format';
import { currentLanguage, tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { Link } from '../../lib/router';
import { useSession } from '../../session';
import { AccountSelect } from '../accounting/common';
import { DOC_LINK, DOC_TYPE, PURCHASE_KIND, SALES_KIND, VAT_WARNING, monthOf, useVatSummary } from './VatSummary';
import { useVatMonth } from './VatReturnPanel';
import '../sales/pagekit.css';
import '../accounting/acc.css';

// New UI (24 Nov 2026, erp-master: Grant's accounting screens, Grant signs off): one VAT month, from the documents to closing and
// paying it, in three versions, Design Lab "VAT month". Same data and rules as the old VAT summary and its closing panel
// (useVatSummary, useVatMonth): closing makes a journal that someone else approves, or that the owner or head accountant posts.
//   A  Dynamics period: the month as the title, a status path (open, closed, paid), the figures, then sales, purchases, documents.
//   B  Like the return: numbered boxes in the order of a VAT return, actions beside it. Box names are ours until the accountant
//      gives Form 10's headings.
//   C  Twelve months: every month of the year in one list with its VAT and status; open a month for its detail and actions.
const VERSIONS = ['A', 'B', 'C'] as const;

const shiftMonth = (from: string, by: number) => {
  const [y, m] = from.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return monthOf(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
};
const monthName = (from: string) =>
  new Date(`${from}T00:00:00Z`).toLocaleDateString(currentLanguage() === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function VatMonthNew() {
  const version = useLabChoice('vatmonth', VERSIONS, 'A');
  if (version === 'C') return <VatYear />;
  return <VatOneMonth version={version} />;
}

/** The status of a VAT month in words, and which step of open → closed → paid it is at. */
function useStatus(vm: ReturnType<typeof useVatMonth>) {
  const v = vm.v;
  const live = vm.live;
  if (!v) return { step: 0, text: '' };
  if (!live) return { step: 0, text: v.ended ? tr('Ended, not closed yet') : tr('Open: the month has not ended') };
  if (live.journalStatus === 'draft') return { step: 1, text: tr('Closing journal waiting for approval') };
  if (live.dueMinor <= 0) return { step: 2, text: tr('Closed with a credit carried forward') };
  if (live.leftMinor > 0) return { step: 1, text: trf('Closed; {left} left to pay', { left: vm.money(live.leftMinor) }) };
  return { step: 2, text: tr('Closed and paid') };
}

function Actions({ vm, big }: { vm: ReturnType<typeof useVatMonth>; big?: boolean }) {
  const v = vm.v;
  if (!v || !vm.canCreate) return null;
  const live = vm.live;
  const post = vm.canPostDirect ? (
    <label className="ac-check"><input type="checkbox" checked={vm.postNow} onChange={(e) => vm.setPostNow(e.target.checked)} />{tr('Post now (no approval)')}</label>
  ) : null;
  if (!live) {
    return (
      <div className={`ac-vat-act${big ? ' big' : ''}`}>
        {post}
        <button type="button" className="pk-act pk-act-main" disabled={vm.busy || !vm.canCloseNow} onClick={vm.close}>{tr('Close this VAT month')}</button>
        {!v.ended ? <span className="pk-muted">{tr('A month can be closed after it has ended.')}</span> : null}
      </div>
    );
  }
  if (live.journalStatus === 'posted' && live.leftMinor > 0) {
    return (
      <div className={`ac-vat-act ac-vat-pay${big ? ' big' : ''}`}>
        <div className="ac-field ac-payfrom"><span>{tr('Paid from (bank or cash account)')}</span><AccountSelect accounts={vm.leafAccounts} value={vm.payFrom} onChange={vm.setPayFrom} label={tr('Paid from (bank or cash account)')} /></div>
        <label className="ac-field"><span>{tr('Amount')}</span><input inputMode="decimal" value={vm.payAmount} placeholder={String(live.leftMinor / 100)} onChange={(e) => vm.setPayAmount(e.target.value)} /></label>
        <label className="ac-field"><span>{tr('Paid on')}</span><DateInput value={vm.payOn} onChange={(e) => vm.setPayOn(e.target.value)} /></label>
        {post}
        <button type="button" className="pk-act pk-act-main" disabled={vm.busy || !vm.payFrom} onClick={vm.pay}>{tr('Record the payment')}</button>
      </div>
    );
  }
  if (live.journalStatus === 'draft') return <p className="pk-muted">{tr('This month\'s closing journal is waiting for approval (Accounting → Journals).')} <Link to="/accounting/journals">{tr('Open')}</Link></p>;
  return null;
}

function VatOneMonth({ version }: { version: 'A' | 'B' }) {
  const vs = useVatSummary();
  // keyed by month: the closing figures (useVatMonth) load once per month
  return <MonthBody key={vs.shown.from} vs={vs} version={version} />;
}

function MonthBody({ vs, version }: { vs: ReturnType<typeof useVatSummary>; version: 'A' | 'B' }) {
  const session = useSession();
  const vm = useVatMonth(vs.shown.from);
  const status = useStatus(vm);
  const s = vs.s;
  const go = (by: number) => vs.show(shiftMonth(vs.shown.from, by));
  const isNow = vs.shown.from === monthOf(todayIn()).from;
  const v = vm.v;
  const money = vs.money;
  const picker = (
    <div className="ac-monthpick">
      <button type="button" className="pk-act" onClick={() => go(-1)} aria-label={tr('Previous month')}><span className="ac-flip">‹</span></button>
      <h1>{monthName(vs.shown.from)}</h1>
      <button type="button" className="pk-act" onClick={() => go(1)} disabled={isNow} aria-label={tr('Next month')}><span className="ac-flip">›</span></button>
    </div>
  );
  const tools = (
    <div className="pk-bar" role="toolbar" aria-label={tr('Actions')}>
      <span className="pk-muted">{status.text}</span>
      <span className="pk-bar-gap" />
      <button type="button" className="pk-act" onClick={() => void vs.download()}>{tr('Download CSV')}</button>
      <button type="button" className="pk-act" onClick={() => window.print()}>{tr('Print')}</button>
    </div>
  );
  if (!s) return <section className="page pk pk-wide ac"><p className="pk-kind">{tr('VAT month')}</p>{picker}<Loading error={vs.data.error} /></section>;
  const warnings = s.warnings.map((w) => (
    <p key={w} className={`ac-msgbar${w === 'partial_deduction' || w === 'before_vat_from' ? ' bad' : ''}`}>{tr(VAT_WARNING[w])}{w === 'other_currency' ? ` (${s.otherCurrencyDocuments})` : ''}</p>
  ));
  const diffNote = v && v.differenceMinor ? <p className="ac-msgbar bad">{trf('The books differ from the documents by {amount}. Check manual journals and documents dated in this month before closing.', { amount: money(v.differenceMinor) })}</p> : null;
  const credit = v && v.creditStreak > 0 ? (
    <p className="ac-msgbar">{v.refundAvailable
      ? trf('{n} credit months in a row: a refund can be asked for (to confirm with your accountant).', { n: v.creditStreak })
      : trf('{n} credit month(s) in a row. A refund can be asked for after more than {limit}.', { n: v.creditStreak, limit: v.smallEnterprise ? 3 : 4 })}</p>
  ) : null;
  const messages = <>{warnings}{diffNote}{credit}{vm.message ? <p className={vm.message.ok ? 'notice' : 'error notice'}>{vm.message.text}</p> : null}{vs.message ? <p className="pk-muted">{vs.message}</p> : null}</>;
  const dueLabel = s.dueMinor >= 0 ? tr('VAT due') : tr('VAT credit to carry forward');

  if (version === 'B') {
    let n = 0;
    const box = (label: string, net: number | null, tax: number | null, strong = false, k?: string) => {
      n += 1;
      return (
        <tr key={n} className={`${strong ? 'ac-totalrow' : ''}${k && vs.section === k ? ' pk-sel' : ''}`} onClick={k ? () => vs.pick(k) : undefined}>
          <td className="ac-boxno">{n}</td><td>{label}</td><td className="pk-num">{net === null ? '' : money(net)}</td><td className="pk-num">{tax === null ? '' : strong ? <strong>{money(tax)}</strong> : money(tax)}</td>
        </tr>
      );
    };
    return (
      <section className="page pk pk-wide ac">
        <p className="pk-kind">{tr('VAT return')}</p>
        {picker}
        {tools}
        {messages}
        <div className="ac-return">
          <div className="ac-form">
            <p className="pk-muted">{trf('{from} to {to}, in {currency}.', { from: formatDay(s.from, session.org), to: formatDay(s.to, session.org), currency: s.currency })} {tr('Box names are ours until the accountant gives the return\'s headings.')}</p>
            <div className="pk-table-wrap"><table className="pk-table">
              <thead><tr><th scope="col">{tr('Box')}</th><th scope="col">{tr('Section')}</th><th scope="col" className="pk-num">{tr('Before VAT')}</th><th scope="col" className="pk-num">{tr('VAT')}</th></tr></thead>
              <tbody>
                <tr className="ac-boxhead"><th colSpan={4} scope="rowgroup">{tr('Sales (output VAT)')}</th></tr>
                {s.sales.map((r) => box(r.kind === 'taxable' ? trf('Taxable sales at {rate}%', { rate: r.rate }) : tr(SALES_KIND[r.kind] ?? r.kind), r.netMinor, r.taxMinor, false, vs.key('sales', r.kind, r.rate)))}
                {box(tr('Output VAT'), null, s.outputTaxMinor, true)}
                <tr className="ac-boxhead"><th colSpan={4} scope="rowgroup">{tr('Purchases (input VAT)')}</th></tr>
                {s.purchases.map((r) => box(tr(PURCHASE_KIND[r.kind] ?? r.kind), r.netMinor, r.deductibleTaxMinor, false, vs.key('purchases', r.kind, 0)))}
                {box(tr('Input VAT deducted'), null, s.inputTaxMinor, true)}
                <tr className="ac-boxhead"><th colSpan={4} scope="rowgroup">{tr('Result')}</th></tr>
                {box(dueLabel, null, Math.abs(s.dueMinor), true)}
              </tbody>
            </table></div>
          </div>
          <aside className="pk-side ac-return-side">
            <p className="pk-label">{tr('Status')}</p>
            <p className="pk-strong">{status.text}</p>
            {v ? <dl className="pk-dl"><div><dt>{tr('Return due by')}</dt><dd>{formatDay(v.returnDueOn, session.org)}</dd></div><div><dt>{tr('Output VAT in the books')}</dt><dd>{money(v.ledgerOutputMinor)}</dd></div><div><dt>{tr('Input VAT in the books')}</dt><dd>{money(v.ledgerInputMinor)}</dd></div></dl> : null}
            {vs.canClose ? <Actions vm={vm} big /> : null}
          </aside>
        </div>
        <Documents vs={vs} />
      </section>
    );
  }

  // A
  const steps = [tr('Open'), tr('Closed'), tr('Paid')];
  return (
    <section className="page pk pk-wide ac">
      <p className="pk-kind">{tr('VAT month')}</p>
      {picker}
      <ol className="pk-steps">{steps.map((t, i) => <li key={t} className={i < status.step ? 'done' : i === status.step ? 'current' : ''}>{t}</li>)}</ol>
      {tools}
      {messages}
      <div className="pk-strip">
        <div><span>{tr('Output VAT')}</span><strong>{money(s.outputTaxMinor)}</strong></div>
        <div><span>{tr('Input VAT deducted')}</span><strong>{s.inputTaxMinor > 0 ? '−' : ''}{money(s.inputTaxMinor)}</strong></div>
        <div><span>{dueLabel}</span><strong className={s.dueMinor < 0 ? 'ac-ok' : undefined}>{money(Math.abs(s.dueMinor))}</strong></div>
        {v ? <div><span>{tr('Return due by')}</span><strong>{formatDay(v.returnDueOn, session.org)}</strong></div> : null}
      </div>
      {vs.canClose ? <Actions vm={vm} /> : null}
      <section className="pk-section">
        <h2>{tr('Sales (output VAT)')}</h2>
        <div className="pk-table-wrap"><table className="pk-table">
          <thead><tr><th scope="col">{tr('Section')}</th><th scope="col" className="pk-num">{tr('Invoices')}</th><th scope="col" className="pk-num">{tr('Credit and debit notes')}</th><th scope="col" className="pk-num">{tr('Before VAT')}</th><th scope="col" className="pk-num">{tr('VAT')}</th></tr></thead>
          <tbody>
            {s.sales.map((r) => { const k = vs.key('sales', r.kind, r.rate); return (
              <tr key={k} className={vs.section === k ? 'pk-sel' : undefined} onClick={() => vs.pick(k)}>
                <td>{r.kind === 'taxable' ? trf('Taxable sales at {rate}%', { rate: r.rate }) : tr(SALES_KIND[r.kind] ?? r.kind)}</td>
                <td className="pk-num">{money(r.invoicesNetMinor)}</td><td className="pk-num">{money(r.notesNetMinor)}</td><td className="pk-num">{money(r.netMinor)}</td><td className="pk-num">{money(r.taxMinor)}</td>
              </tr>); })}
            {!s.sales.length ? <tr><td colSpan={5} className="pk-empty">{tr('No sales in this period.')}</td></tr> : null}
          </tbody>
        </table></div>
      </section>
      <section className="pk-section">
        <h2>{tr('Purchases (input VAT)')}</h2>
        <div className="pk-table-wrap"><table className="pk-table">
          <thead><tr><th scope="col">{tr('Section')}</th><th scope="col" className="pk-num">{tr('Before VAT')}</th><th scope="col" className="pk-num">{tr('VAT deducted')}</th><th scope="col" className="pk-num">{tr('VAT not deductible (in the cost)')}</th></tr></thead>
          <tbody>
            {s.purchases.map((r) => { const k = vs.key('purchases', r.kind, 0); return (
              <tr key={k} className={vs.section === k ? 'pk-sel' : undefined} onClick={() => vs.pick(k)}>
                <td>{tr(PURCHASE_KIND[r.kind] ?? r.kind)}</td><td className="pk-num">{money(r.netMinor)}</td><td className="pk-num">{money(r.deductibleTaxMinor)}</td><td className="pk-num">{money(r.nonDeductibleTaxMinor)}</td>
              </tr>); })}
            {!s.purchases.length ? <tr><td colSpan={4} className="pk-empty">{tr('No purchases in this period.')}</td></tr> : null}
          </tbody>
        </table></div>
      </section>
      <Documents vs={vs} />
    </section>
  );
}

function Documents({ vs }: { vs: ReturnType<typeof useVatSummary> }) {
  const session = useSession();
  return (
    <details className="pk-fold">
      <summary>{trf('Documents ({n})', { n: vs.docs.length })}{vs.section ? <button type="button" className="pk-more ac-showall" onClick={(e) => { e.preventDefault(); vs.setSection(null); }}>{tr('Show all')}</button> : null}</summary>
      <div className="pk-table-wrap"><table className="pk-table">
        <thead><tr><th scope="col">{tr('Date')}</th><th scope="col">{tr('Document')}</th><th scope="col">{tr('Type')}</th><th scope="col" className="pk-num">{tr('Before VAT')}</th><th scope="col" className="pk-num">{tr('VAT')}</th></tr></thead>
        <tbody>
          {vs.docs.map((d) => { const href = DOC_LINK[d.type]?.(d.id) ?? null; return (
            <tr key={`${d.type}:${d.id}:${d.kind}:${d.rate}`}>
              <td>{formatDay(d.date, session.org)}</td><td>{href ? <Link to={href}><code>{d.number}</code></Link> : <code>{d.number}</code>}</td><td>{tr(DOC_TYPE[d.type] ?? d.type)}</td>
              <td className="pk-num">{vs.money(d.netMinor)}</td><td className="pk-num">{vs.money(d.taxMinor + d.nonDeductibleTaxMinor)}</td>
            </tr>); })}
          {!vs.docs.length ? <tr><td colSpan={5} className="pk-empty">{tr('No documents.')}</td></tr> : null}
        </tbody>
      </table></div>
    </details>
  );
}

// ------------------------------------------------------------------ C: twelve months

function VatYear() {
  const now = monthOf(todayIn()).from;
  const year = Number(now.slice(0, 4));
  const [y, setY] = useState(year);
  const [openM, setOpenM] = useState<string | null>(null);
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}-01`).filter((m) => m <= now);
  return (
    <section className="page pk pk-wide ac">
      <p className="pk-kind">{tr('VAT months')}</p>
      <div className="ac-monthpick">
        <button type="button" className="pk-act" onClick={() => setY(y - 1)} aria-label={tr('Previous year')}><span className="ac-flip">‹</span></button>
        <h1>{y}</h1>
        <button type="button" className="pk-act" onClick={() => setY(y + 1)} disabled={y >= year} aria-label={tr('Next year')}><span className="ac-flip">›</span></button>
      </div>
      <p className="pk-muted">{tr('Every month of the year, its VAT from the books and where it stands. Open a month to close it or pay it.')}</p>
      <div className="pk-table-wrap"><table className="pk-table ac-year">
        <thead><tr><th scope="col">{tr('Month')}</th><th scope="col" className="pk-num">{tr('Output VAT')}</th><th scope="col" className="pk-num">{tr('Input VAT')}</th><th scope="col" className="pk-num">{tr('Due or credit')}</th><th scope="col">{tr('Status')}</th><th scope="col"><span className="pk-visually-hidden">{tr('Actions')}</span></th></tr></thead>
        <tbody>{[...months].reverse().map((m) => <YearRow key={m} month={m} open={openM === m} onToggle={() => setOpenM(openM === m ? null : m)} />)}</tbody>
      </table></div>
    </section>
  );
}

function YearRow({ month, open, onToggle }: { month: string; open: boolean; onToggle: () => void }) {
  const session = useSession();
  const vm = useVatMonth(month);
  const status = useStatus(vm);
  const v = vm.v;
  const need = v && !vm.live && v.ended ? 'close' : vm.live && vm.live.journalStatus === 'posted' && vm.live.leftMinor > 0 ? 'pay' : null;
  const overdue = need && v ? v.returnDueOn < todayIn() : false;
  return (
    <>
      <tr className={open ? 'pk-sel' : undefined} onClick={onToggle}>
        <td><strong>{monthName(month)}</strong></td>
        <td className="pk-num">{v ? vm.money(v.ledgerOutputMinor) : '…'}</td>
        <td className="pk-num">{v ? vm.money(v.ledgerInputMinor) : '…'}</td>
        <td className="pk-num">{v ? (v.ledgerDueMinor >= 0 ? vm.money(v.ledgerDueMinor) : <span className="ac-ok">{trf('{amount} credit', { amount: vm.money(-v.ledgerDueMinor) })}</span>) : ''}</td>
        <td><span className={`ac-status s${status.step}${overdue ? ' late' : ''}`}>{status.text}{overdue ? ` · ${tr('late')}` : ''}</span></td>
        <td className="pk-num">{need ? <button type="button" className="pk-act pk-act-main" onClick={(e) => { e.stopPropagation(); if (!open) onToggle(); }}>{need === 'close' ? tr('Close') : tr('Pay')}</button> : <span className="pk-muted">{open ? '▴' : '▾'}</span>}</td>
      </tr>
      {open && v ? (
        <tr className="ac-yeardetail"><td colSpan={6}>
          <dl className="pk-dl ac-yeardl">
            <div><dt>{tr('Return due by')}</dt><dd>{formatDay(v.returnDueOn, session.org)}</dd></div>
            {vm.live ? <><div><dt>{tr('Paid')}</dt><dd>{vm.money(vm.live.paidMinor)}</dd></div><div><dt>{tr('Left to pay')}</dt><dd>{vm.money(vm.live.leftMinor)}</dd></div></> : null}
          </dl>
          {vm.message ? <p className={vm.message.ok ? 'notice' : 'error notice'}>{vm.message.text}</p> : null}
          <Actions vm={vm} />
        </td></tr>
      ) : null}
    </>
  );
}
