import type { CSSProperties, ReactNode } from 'react';
import {
  divRound,
  etaForPrint,
  formatAmount,
  formatQty,
  isDraftPrint,
  withDigits,
  type DocLanguage,
  type DocLayout,
  type DocPrintData,
  type Issue,
  type PrintLine,
} from '@erp/shared';
import { tr, trf } from '../../../lib/i18n';
import { docAppPath } from '../../../lib/docLink';
import { nextStepFor } from '../../../lib/nextStep';
import { Link } from '../../../lib/router';
import { DocQr } from './DocQr';
import { label, printDir, type PrintLabelKey } from './printLabels';
import './print.css';

// One printed document on A4 (INVOICE_PRINTING_PLAN.md section 2, step 1c): our own HTML, right to left for Arabic. Three layouts:
// simple, detailed (VAT on each line) and ETA (every ETA field, "Not yet submitted to ETA", an empty QR area). A draft, or a note that is
// not approved, carries a large DRAFT mark; a void invoice a VOID mark. The same component prints, makes the PDF, and shows the public link.

export type PrintOptions = { layout: DocLayout; language: DocLanguage };

const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');

/** The ETA builder's 5-place decimal as minor units (2 places). */
const decMinor = (v: bigint) => divRound(v, 1000n);

function docTitle(data: DocPrintData, lang: DocLanguage): string {
  const k = data.document.kind;
  if (k === 'credit') return label('creditNote', lang);
  if (k === 'debit') return label('debitNote', lang);
  return label(data.company.vatRegistered ? 'taxInvoice' : 'invoice', lang);
}

/** What the ETA layout cannot print without, in the screen's language. */
export function etaIssueText(issue: Issue, lines: PrintLine[]): string {
  const m = /^lines\[(\d+)\]/.exec(issue.path);
  const name = m ? (lines[Number(m[1])]?.name ?? '') : '';
  switch (issue.code) {
    case 'COMPANY_TAX_NUMBER':
      return tr('The company tax registration number');
    case 'ACTIVITY_CODE':
      return tr('The company activity code');
    case 'BRANCH_ADDRESS':
      return tr('A company branch with its full address (E-invoicing settings)');
    case 'CUSTOMER':
      return tr('The customer');
    case 'CUSTOMER_TAX_ID':
      return tr('The customer tax ID (business customer)');
    case 'CUSTOMER_TAX_IDENTITY':
      return tr('The customer tax identity (business, person or foreign)');
    case 'ITEM_CODE':
      return trf('The ETA item code of "{name}"', { name });
    case 'UNIT_TYPE':
      return trf('The ETA unit code of "{name}"', { name });
    case 'CURRENCY_NOT_SUPPORTED':
      return tr('ETA invoices are in EGP only for now');
    default:
      return issue.message;
  }
}

/**
 * Where a missing ETA field is set (dead-ends audit, 25 Nov 2026). The company's tax registration and its ETA branch address are on
 * Settings → E-invoicing (lib/nextStep.ts `eta_company_missing`); the ETA branch is not the company branch on Settings → Branches.
 */
export function etaIssueLink(issue: Issue, lines: PrintLine[]): string | null {
  const m = /^lines\[(\d+)\]/.exec(issue.path);
  const itemId = m ? lines[Number(m[1])]?.itemId : undefined;
  switch (issue.code) {
    case 'COMPANY_TAX_NUMBER':
    case 'ACTIVITY_CODE':
    case 'BRANCH_ADDRESS':
      return nextStepFor('eta_company_missing')?.to ?? null;
    case 'CUSTOMER':
    case 'CUSTOMER_TAX_ID':
    case 'CUSTOMER_TAX_IDENTITY':
      return '/sales/customers';
    case 'ITEM_CODE':
    case 'UNIT_TYPE':
      return itemId ? `/inventory/items/${itemId}` : null;
    default:
      return null;
  }
}

export function PrintDocument({ data, options }: { data: DocPrintData; options: PrintOptions }) {
  const { layout, language: lang } = options;
  const s = data.settings;
  const digits = s.digits;
  const doc = data.document;
  const cur = doc.currency;
  const money = (minor: number | bigint) => formatAmount(minor, cur, digits);
  const qty = (q: number) => formatQty(q, digits);
  const num = (t: string | null | undefined) => (t ? withDigits(t, digits) : '');
  const lbl = (k: PrintLabelKey) => label(k, lang);
  const draft = isDraftPrint(doc);
  const isVoid = doc.type === 'invoice' && doc.status === 'void';
  const anyVat = doc.taxMinor > 0 || data.lines.some((l) => l.taxRate > 0);
  const inclusive = data.lines.some((l) => l.priceIncludesVat);

  const eta = layout === 'eta' ? etaForPrint(data) : null;
  if (eta && !eta.built) {
    return (
      <div className="print-missing" role="alert">
        <p><strong>{tr('The ETA layout cannot print yet. This is missing:')}</strong></p>
        <ul>{eta.issues.map((i, n) => <li key={`${i.code}-${n}`}>{etaIssueText(i, data.lines)}{etaIssueLink(i, data.lines) ? <> · <Link to={etaIssueLink(i, data.lines) as string}>{tr('Fix it')}</Link></> : null}</li>)}</ul>
      </div>
    );
  }

  const sheetStyle: CSSProperties = s.letterhead
    ? { backgroundImage: `url("${s.letterhead}")`, paddingBlockStart: `${s.marginTopMm}mm`, paddingBlockEnd: `${s.marginBottomMm}mm` }
    : {};

  const info: [PrintLabelKey, ReactNode][] = [
    ['number', <span key="n" className="print-mono">{doc.number ? num(doc.number) : lbl('draft')}</span>],
    ['date', num(d10(doc.date))],
    ...(doc.dueDate ? ([['dueDate', num(d10(doc.dueDate))]] as [PrintLabelKey, ReactNode][]) : []),
    ...(doc.orderNumber ? ([['order', num(doc.orderNumber)]] as [PrintLabelKey, ReactNode][]) : []),
    ...(doc.invoiceNumber ? ([['forInvoice', num(doc.invoiceNumber)]] as [PrintLabelKey, ReactNode][]) : []),
    ['currency', cur],
  ];

  const c = data.customer;
  const company = data.company;
  // The Arabic comma on Arabic paper, the Western comma on English-only paper.
  const sep = lang === 'en' ? ', ' : '، ';
  const branchAddress = company.branch
    ? [company.branch.buildingNumber, company.branch.street, company.branch.regionCity, company.branch.governate].filter(Boolean).join(sep)
    : '';
  const customerAddress = c ? [c.buildingNumber, c.street, c.regionCity ?? c.city, c.governate].filter(Boolean).join(sep) : '';

  return (
    <article className={`print-sheet print-${layout}`} dir={printDir(lang)} lang={lang === 'en' ? 'en' : 'ar'} style={sheetStyle} data-letterhead={s.letterhead ? 'yes' : 'no'}>
      {draft || isVoid ? <div className="print-watermark" aria-hidden="true">{isVoid ? lbl('void') : lbl('draft')}</div> : null}

      <header className="print-head">
        {!s.letterhead ? (
          <div className="print-company">
            {s.logo ? <img className="print-logo" src={s.logo} alt="" /> : null}
            <div>
              <div className="print-company-name">{company.legalName ?? company.name}</div>
              {company.taxNumber ? <div>{lbl('taxNumber')}: <span className="print-mono">{num(company.taxNumber)}</span></div> : null}
              {branchAddress ? <div>{num(branchAddress)}</div> : null}
              {s.headerText ? <div className="print-pre">{s.headerText}</div> : null}
            </div>
          </div>
        ) : (
          <div className="print-company">
            {company.taxNumber ? <div>{lbl('taxNumber')}: <span className="print-mono">{num(company.taxNumber)}</span></div> : null}
          </div>
        )}
        <div className="print-title-block">
          <h1 className="print-title">{docTitle(data, lang)}</h1>
          <dl className="print-info">
            {info.map(([k, v]) => <div key={k}><dt>{lbl(k)}</dt><dd>{v}</dd></div>)}
          </dl>
        </div>
      </header>

      <section className="print-parties">
        {layout === 'eta' ? (
          <div className="print-party">
            <h2>{lbl('seller')}</h2>
            <div>{company.legalName ?? company.name}</div>
            <div>{lbl('taxNumber')}: <span className="print-mono">{num(company.taxNumber)}</span></div>
            <div>{lbl('activityCode')}: <span className="print-mono">{num(company.activityCode)}</span></div>
            {branchAddress ? <div>{lbl('address')}: {num(branchAddress)}</div> : null}
          </div>
        ) : null}
        <div className="print-party">
          <h2>{lbl('billTo')}</h2>
          <div className="print-strong">{c?.name ?? ''}</div>
          {c?.taxId ? <div>{lbl('customerTaxId')}: <span className="print-mono">{num(c.taxId)}</span></div> : null}
          {customerAddress ? <div>{lbl('address')}: {num(customerAddress)}</div> : null}
          {c?.phone ? <div>{lbl('phone')}: <span className="print-mono" dir="ltr">{num(c.phone)}</span></div> : null}
        </div>
      </section>

      {doc.reason ? <p className="print-reason"><strong>{lbl('reason')}:</strong> {doc.reason}</p> : null}

      <table className="print-lines">
        <thead>
          <tr>
            <th scope="col" className="print-num">{lbl('lineNo')}</th>
            <th scope="col">{lbl('item')}</th>
            {layout === 'eta' ? <><th scope="col">{lbl('codeType')}</th><th scope="col">{lbl('itemCode')}</th><th scope="col">{lbl('unitCode')}</th></> : null}
            <th scope="col" className="print-num">{lbl('qty')}</th>
            <th scope="col" className="print-num">{inclusive ? lbl('unitPriceWithVat') : lbl('unitPrice')}</th>
            {layout === 'simple' ? (
              <th scope="col" className="print-num">{anyVat ? lbl('beforeVat') : lbl('amount')}</th>
            ) : (
              <>
                <th scope="col" className="print-num">{lbl('beforeVat')}</th>
                {layout === 'eta' ? <th scope="col">{lbl('taxType')}</th> : null}
                <th scope="col" className="print-num">{lbl('vatRate')}</th>
                <th scope="col" className="print-num">{lbl('vat')}</th>
                <th scope="col" className="print-num">{lbl('lineTotal')}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l, i) => (
            <tr key={`${l.itemId}-${i}`}>
              <td className="print-num">{num(String(i + 1))}</td>
              <td>
                <div>{l.name}</div>
                <div className="print-muted print-mono">{l.sku}</div>
              </td>
              {layout === 'eta' ? <><td className="print-mono">{l.etaItemType ?? ''}</td><td className="print-mono">{l.etaItemCode ?? ''}</td><td className="print-mono">{l.etaUnitCode ?? ''}</td></> : null}
              <td className="print-num">{qty(l.qty)}{l.unit && l.unitFactor ? <div className="print-muted">{num(`${formatQty(l.qty / l.unitFactor)} ${l.unit}`)}</div> : null}</td>
              <td className="print-num">{money(l.unitPriceMinor)}</td>
              {layout === 'simple' ? (
                <td className="print-num">{money(l.netMinor)}</td>
              ) : (
                <>
                  <td className="print-num">{money(l.netMinor)}</td>
                  {layout === 'eta' ? <td className="print-mono">{l.taxType ? `${l.taxType} ${l.taxSubType ?? ''}` : ''}</td> : null}
                  <td className="print-num">{l.taxRate > 0 ? `${num(String(Number(l.taxRate)))}%` : '—'}</td>
                  <td className="print-num">{money(l.taxMinor)}</td>
                  <td className="print-num">{money(l.netMinor + l.taxMinor)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="print-bottom">
        <div className="print-extra">
          {s.paymentTerms ? <div><h2>{lbl('terms')}</h2><p className="print-pre">{s.paymentTerms}</p></div> : null}
          {s.bankDetails ? <div><h2>{lbl('bank')}</h2><p className="print-pre">{s.bankDetails}</p></div> : null}
          {layout === 'eta' ? (
            <div className="print-eta-box">
              <div className="print-qr" aria-label={lbl('etaQr')} />
              <p className="print-strong">{lbl('etaNotSubmitted')}</p>
            </div>
          ) : null}
          {/* Scanning step 4: a link into the app; only the company's own signed-in staff can open it. */}
          {typeof window !== 'undefined' ? <DocQr text={`${window.location.origin}${docAppPath(doc)}`} label={lbl('appQr')} /> : null}
        </div>
        <table className="print-totals">
          <tbody>
            {layout === 'eta' && eta?.built ? (
              <>
                <tr><th scope="row">{lbl('salesAmount')}</th><td>{money(decMinor(eta.built.totals.totalSalesAmount))}</td></tr>
                {eta.built.totals.totalDiscountAmount > 0n ? <tr><th scope="row">{lbl('discount')}</th><td>{money(decMinor(eta.built.totals.totalDiscountAmount))}</td></tr> : null}
                <tr><th scope="row">{lbl('netAmount')}</th><td>{money(decMinor(eta.built.totals.netAmount))}</td></tr>
                {eta.built.totals.taxTotals.map((t) => <tr key={t.taxType}><th scope="row">{lbl('vat')} ({t.taxType})</th><td>{money(decMinor(t.amount))}</td></tr>)}
                <tr className="print-grand"><th scope="row">{lbl('totalWithVat')}</th><td>{money(decMinor(eta.built.totals.totalAmount))} {cur}</td></tr>
              </>
            ) : (
              <>
                {anyVat ? <tr><th scope="row">{lbl('subtotal')}</th><td>{money(doc.netMinor)}</td></tr> : null}
                {anyVat ? <tr><th scope="row">{lbl('vat')}</th><td>{money(doc.taxMinor)}</td></tr> : null}
                <tr className="print-grand"><th scope="row">{anyVat ? lbl('totalWithVat') : lbl('total')}</th><td>{money(doc.grossMinor)} {cur}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {s.footerText ? <footer className="print-footer print-pre">{s.footerText}</footer> : null}
    </article>
  );
}
