import { useMemo, useState } from 'react';
import type { TrialBalanceRow } from '@erp/shared';
import { DateInput } from '../../components/DateInput';
import { Loading } from '../../components/Loading';
import { todayIn } from '../../lib/dates';
import { tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { navigate } from '../../lib/router';
import { Notice, accountName, money } from './common';
import { useTrialBalance } from './Ledger';
import '../sales/pagekit.css';
import './acc.css';

// New UI (24 Nov 2026, erp-master: Grant's accounting screens, Grant signs off): the trial balance in three versions, Design Lab
// "Trial balance". Same data and rules as the old page (useTrialBalance): only detail accounts are added up; a group is the sum of
// its sub-accounts; a click opens the account's lines for the same period.
//   A  Dynamics report: period presets, a figures strip (debits, credits, difference), one folding group per main account class.
//   B  Read first: whether the books balance and what moved most, in plain sentences, then the table.
//   C  Accountant's sheet: the classic debit-balance and credit-balance columns, as a tree you open and close.
const VERSIONS = ['A', 'B', 'C'] as const;
type Preset = 'month' | 'last' | 'quarter' | 'year' | 'custom';

function presetRange(p: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const t = todayIn();
  const [y, m] = t.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const end = (yy: number, mm: number) => `${yy}-${pad(mm)}-${pad(new Date(Date.UTC(yy, mm, 0)).getUTCDate())}`;
  if (p === 'month') return { from: `${y}-${pad(m)}-01`, to: t };
  if (p === 'last') { const yy = m === 1 ? y - 1 : y; const mm = m === 1 ? 12 : m - 1; return { from: `${yy}-${pad(mm)}-01`, to: end(yy, mm) }; }
  if (p === 'quarter') { const q = Math.floor((m - 1) / 3) * 3 + 1; return { from: `${y}-${pad(q)}-01`, to: t }; }
  return { from: `${y}-01-01`, to: t };
}

export function TrialBalanceNew() {
  const version = useLabChoice('tb', VERSIONS, 'A');
  const tb = useTrialBalance();
  const [preset, setPreset] = useState<Preset>('year');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [movement, setMovement] = useState(false);
  const rows = tb.rows.data ?? [];
  const byParent = useMemo(() => {
    const m = new Map<string | null, TrialBalanceRow[]>();
    for (const r of rows) m.set(r.parentId, [...(m.get(r.parentId) ?? []), r]);
    return m;
  }, [rows]);
  const cur = tb.shown.currency;
  const fmt = (v: number) => money(v, cur);
  const cell = (v: number) => (v ? fmt(v) : '');
  const openAccount = (r: TrialBalanceRow) => navigate(`/accounting/accounts/${r.accountId}?from=${tb.shown.from}&to=${tb.shown.to}&currency=${cur}`);
  const active = (r: TrialBalanceRow) => r.openingMinor !== 0 || r.debitMinor !== 0 || r.creditMinor !== 0;

  const pickPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') tb.show(presetRange(p));
  };
  const filters = (
    <div className="pk-bar" role="toolbar" aria-label={tr('Filters')}>
      <label className="rp-chip"><span>{tr('Period')}</span>
        <select value={preset} onChange={(e) => pickPreset(e.target.value as Preset)}>
          <option value="month">{tr('This month')}</option><option value="last">{tr('Last month')}</option><option value="quarter">{tr('This quarter')}</option>
          <option value="year">{tr('This year')}</option><option value="custom">{tr('Choose dates')}</option>
        </select>
      </label>
      {preset === 'custom' ? (
        <>
          <label className="rp-chip"><span>{tr('From')}</span><DateInput value={tb.from} onChange={(e) => tb.setFrom(e.target.value)} /></label>
          <label className="rp-chip"><span>{tr('To')}</span><DateInput value={tb.to} onChange={(e) => tb.setTo(e.target.value)} /></label>
          <button type="button" className="pk-act" disabled={!tb.canShow} onClick={() => tb.show()}>{tr('Show')}</button>
        </>
      ) : null}
      <span className="pk-bar-gap" />
      <span className="pk-muted">{trf('{from} to {to}, in {currency}', { from: tb.shown.from, to: tb.shown.to, currency: cur })}</span>
      <button type="button" className="pk-act" disabled={tb.busy} onClick={tb.download}>{tr('Download CSV')}</button>
      <button type="button" className="pk-act" onClick={() => window.print()}>{tr('Print')}</button>
    </div>
  );
  const balancedLine = (
    <p className={`ac-balance ${tb.balanced ? 'ok' : 'bad'}`} role="status">
      {tb.balanced ? `✓ ${tr('The books balance: debits equal credits.')}` : tr('The books do not balance. This is a system fault: contact support and do not post until it is fixed.')}
    </p>
  );
  if (!tb.rows.data) return <section className="page pk pk-wide ac"><div className="pk-head"><div><p className="pk-kind">{tr('Report')}</p><h1>{tr('Trial balance')}</h1></div></div>{filters}<Loading error={tb.rows.error} /></section>;

  const head = (
    <div className="pk-head"><div><p className="pk-kind">{tr('Report')}</p><h1>{tr('Trial balance')}</h1></div></div>
  );
  const fullRow = (r: TrialBalanceRow, depth: number) => (
    <tr key={r.accountId} className={r.isLeaf ? undefined : 'ac-grouprow'} onClick={() => openAccount(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openAccount(r)}>
      <td><code>{r.code}</code></td>
      <td style={{ paddingInlineStart: `${0.9 + depth * 1.1}rem` }}>{accountName(r)}</td>
      <td className="pk-num">{fmt(r.openingMinor)}</td>
      <td className="pk-num">{cell(r.debitMinor)}</td>
      <td className="pk-num">{cell(r.creditMinor)}</td>
      <td className="pk-num"><strong>{fmt(r.closingMinor)}</strong></td>
    </tr>
  );
  const thead = (
    <thead><tr>
      <th scope="col">{tr('Code')}</th><th scope="col">{tr('Account')}</th><th scope="col" className="pk-num">{tr('Opening')}</th>
      <th scope="col" className="pk-num">{tr('Debit')}</th><th scope="col" className="pk-num">{tr('Credit')}</th><th scope="col" className="pk-num">{tr('Closing')}</th>
    </tr></thead>
  );
  const totalRow = (
    <tr className="ac-totalrow">
      <th scope="row" colSpan={2}>{tr('Total of detail accounts')}</th>
      <td className="pk-num">{fmt(tb.total('openingMinor'))}</td><td className="pk-num">{fmt(tb.total('debitMinor'))}</td>
      <td className="pk-num">{fmt(tb.total('creditMinor'))}</td><td className="pk-num">{fmt(tb.total('closingMinor'))}</td>
    </tr>
  );
  const walk = (parent: string | null, depth: number, out: { r: TrialBalanceRow; depth: number }[] = []) => {
    for (const r of byParent.get(parent) ?? []) {
      out.push({ r, depth });
      walk(r.accountId, depth + 1, out);
    }
    return out;
  };

  if (version === 'B') {
    const leaves = rows.filter((r) => r.isLeaf);
    const moved = [...leaves].sort((a, b) => b.debitMinor + b.creditMinor - (a.debitMinor + a.creditMinor)).filter((r) => r.debitMinor + r.creditMinor > 0).slice(0, 5);
    const kindTotal = (k: TrialBalanceRow['kind']) => leaves.filter((r) => r.kind === k).reduce((s, r) => s + r.closingMinor, 0);
    const profit = -(kindTotal('revenue') + kindTotal('expense'));
    return (
      <section className="page pk pk-wide ac">
        {head}{filters}
        <Notice message={tb.message} />
        <div className="rp-read">
          <p className={tb.balanced ? 'ac-ok' : 'ac-bad'}>{tb.balanced ? `✓ ${tr('Your books balance.')}` : tr('Your books do not balance. Contact support before you post anything else.')}</p>
          <p>{trf('From {from} to {to}, {debits} was posted on the debit side and the same on the credit side, across {n} accounts.', { from: tb.shown.from, to: tb.shown.to, debits: fmt(tb.total('debitMinor')), n: leaves.filter(active).length })}</p>
          <p>{profit >= 0 ? trf('Revenue less expenses for the period: a profit of {amount}.', { amount: fmt(profit) }) : trf('Revenue less expenses for the period: a loss of {amount}.', { amount: fmt(-profit) })}</p>
        </div>
        {moved.length ? (
          <>
            <h2 className="pk-h2">{tr('What moved most')}</h2>
            <ol className="ac-moved">
              {moved.map((r) => (
                <li key={r.accountId}><button type="button" onClick={() => openAccount(r)}><span><code>{r.code}</code> {accountName(r)}</span><span className="pk-num">{trf('{debit} in, {credit} out', { debit: fmt(r.debitMinor), credit: fmt(r.creditMinor) })}</span></button></li>
              ))}
            </ol>
          </>
        ) : null}
        <h2 className="pk-h2">{tr('Every account')}</h2>
        <div className="pk-table-wrap"><table className="pk-table">{thead}<tbody>{walk(null, 0).filter(({ r }) => active(r) || !r.isLeaf).map(({ r, depth }) => fullRow(r, depth))}{totalRow}</tbody></table></div>
      </section>
    );
  }

  if (version === 'C') {
    const shownRows = (() => {
      const out: { r: TrialBalanceRow; depth: number }[] = [];
      const go = (parent: string | null, depth: number) => {
        for (const r of byParent.get(parent) ?? []) {
          out.push({ r, depth });
          if (open.has(r.accountId)) go(r.accountId, depth + 1);
        }
      };
      go(null, 0);
      return out;
    })();
    const toggle = (id: string) => { const n = new Set(open); n.has(id) ? n.delete(id) : n.add(id); setOpen(n); };
    const leaves = rows.filter((r) => r.isLeaf);
    const drBal = leaves.reduce((s, r) => s + Math.max(r.closingMinor, 0), 0);
    const crBal = leaves.reduce((s, r) => s + Math.max(-r.closingMinor, 0), 0);
    return (
      <section className="page pk pk-wide ac">
        {head}{filters}
        <Notice message={tb.message} />
        <div className="ac-treebar">
          <button type="button" className="pk-act" onClick={() => setOpen(new Set(rows.filter((r) => !r.isLeaf).map((r) => r.accountId)))}>{tr('Open all')}</button>
          <button type="button" className="pk-act" onClick={() => setOpen(new Set())}>{tr('Close all')}</button>
          <label className="ac-check"><input type="checkbox" checked={movement} onChange={(e) => setMovement(e.target.checked)} />{tr('Show opening and movements')}</label>
          <span className="pk-bar-gap" />{balancedLine}
        </div>
        <div className="pk-table-wrap"><table className="pk-table ac-tree">
          <thead><tr>
            <th scope="col">{tr('Account')}</th>
            {movement ? <><th scope="col" className="pk-num">{tr('Opening')}</th><th scope="col" className="pk-num">{tr('Debit')}</th><th scope="col" className="pk-num">{tr('Credit')}</th></> : null}
            <th scope="col" className="pk-num">{tr('Debit balance')}</th><th scope="col" className="pk-num">{tr('Credit balance')}</th>
          </tr></thead>
          <tbody>
            {shownRows.map(({ r, depth }) => (
              <tr key={r.accountId} className={r.isLeaf ? undefined : 'ac-grouprow'}>
                <td style={{ paddingInlineStart: `${0.6 + depth * 1.25}rem` }}>
                  {r.isLeaf
                    ? <button type="button" className="ac-leaf" onClick={() => openAccount(r)}><code>{r.code}</code> {accountName(r)}</button>
                    : <button type="button" className="ac-twisty" aria-expanded={open.has(r.accountId)} onClick={() => toggle(r.accountId)}><span aria-hidden="true">{open.has(r.accountId) ? '▾' : '▸'}</span> <code>{r.code}</code> {accountName(r)}</button>}
                </td>
                {movement ? <><td className="pk-num">{cell(r.openingMinor)}</td><td className="pk-num">{cell(r.debitMinor)}</td><td className="pk-num">{cell(r.creditMinor)}</td></> : null}
                <td className="pk-num">{r.closingMinor > 0 ? fmt(r.closingMinor) : ''}</td>
                <td className="pk-num">{r.closingMinor < 0 ? fmt(-r.closingMinor) : ''}</td>
              </tr>
            ))}
            <tr className="ac-totalrow">
              <th scope="row">{tr('Total')}</th>
              {movement ? <><td className="pk-num">{fmt(tb.total('openingMinor'))}</td><td className="pk-num">{fmt(tb.total('debitMinor'))}</td><td className="pk-num">{fmt(tb.total('creditMinor'))}</td></> : null}
              <td className="pk-num">{fmt(drBal)}</td><td className="pk-num">{fmt(crBal)}</td>
            </tr>
          </tbody>
        </table></div>
      </section>
    );
  }

  // A
  const classes = byParent.get(null) ?? [];
  return (
    <section className="page pk pk-wide ac">
      {head}{filters}
      <Notice message={tb.message} />
      <div className="pk-strip">
        <div><span>{tr('Total debits')}</span><strong>{fmt(tb.total('debitMinor'))}</strong></div>
        <div><span>{tr('Total credits')}</span><strong>{fmt(tb.total('creditMinor'))}</strong></div>
        <div><span>{tr('Difference')}</span><strong className={tb.balanced ? 'ac-ok' : 'ac-bad'}>{tb.balanced ? `✓ ${tr('Balanced')}` : fmt(tb.total('debitMinor') - tb.total('creditMinor'))}</strong></div>
        <div><span>{tr('Accounts with entries')}</span><strong>{rows.filter((r) => r.isLeaf && active(r)).length}</strong></div>
      </div>
      <label className="ac-check"><input type="checkbox" checked={tb.leafOnly} onChange={(e) => tb.setLeafOnly(e.target.checked)} />{tr('Detail accounts only')}</label>
      {classes.map((c) => {
        const inside = walk(c.accountId, 1).filter(({ r }) => !tb.leafOnly || r.isLeaf);
        return (
          <details key={c.accountId} className="pk-fold rp-group" open>
            <summary><span><code>{c.code}</code> {accountName(c)}</span><span className="pk-muted">{tr('Closing')} <bdi>{fmt(c.closingMinor)}</bdi></span></summary>
            <div className="pk-table-wrap"><table className="pk-table">{thead}<tbody>{tb.leafOnly ? null : fullRow(c, 0)}{inside.map(({ r, depth }) => fullRow(r, tb.leafOnly ? 0 : depth))}</tbody></table></div>
          </details>
        );
      })}
    </section>
  );
}
