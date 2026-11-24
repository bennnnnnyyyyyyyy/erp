import { useState } from 'react';
import { DateInput } from '../../components/DateInput';
import { ConfirmButton } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { Link, navigate } from '../../lib/router';
import { AccountSelect, Notice, accountLabel, money } from './common';
import { blankLine, useJournalEditor, type DraftLine } from './Ledger';
import '../sales/pagekit.css';
import './acc.css';

// New UI (24 Nov 2026, erp-master: Grant's accounting screens, Grant signs off): a manual journal in three versions, Design Lab
// "Journal entry". Same logic as the old page (useJournalEditor): same checks, same "save for approval" or "post now" (owner or
// head accountant only; the database decides), nothing saved until a button is pressed.
//   A  Dynamics journal: actions on top, a General section, the lines grid with its own toolbar, a live totals line (debit, credit,
//      difference), problems in a bar that never stops typing, and "Preview posting" (how the entry will post) before saving.
//   B  Two sides: debits on one side, credits on the other, a balance line between them that shows which side is short.
//   C  Simple: one sentence ("move this amount from this account to that one"); "Split into more lines" opens the full grid.
const VERSIONS = ['A', 'B', 'C'] as const;

export function JournalFormNew() {
  const version = useLabChoice('journal', VERSIONS, 'A');
  const j = useJournalEditor();
  const [preview, setPreview] = useState(false);
  const [split, setSplit] = useState(false);
  const [blankSide, setBlankSide] = useState<Record<number, 'debit' | 'credit'>>({});
  if (!j.ready) return <section className="page"><Loading error={j.error} /></section>;
  const { id, existing, accounts, customers, suppliers, f, set, setLine, lines, dr, cr, problem, problemText, canPost, save, message, busy, currencies } = j;
  const title = id ? trf('Change draft {number}', { number: existing?.number ?? '' }) : tr('New manual journal');
  const missing = !f.memo.trim() ? tr('Add a description to save.') : !f.entryDate ? tr('Choose a date.') : null;
  const blocked = busy || !!problem || !!missing;
  const diff = dr - cr;
  const acct = (aid: string) => accounts.find((a) => a.id === aid);
  const removeLine = (i: number) => set({ lines: f.lines.filter((_, k) => k !== i) });

  const general = (
    <div className="ac-general">
      <label className="ac-field"><span>{tr('Date')}</span><DateInput value={f.entryDate} onChange={(e) => set({ entryDate: e.target.value })} /></label>
      <label className="ac-field"><span>{tr('Type')}</span>
        <select value={f.kind} onChange={(e) => set({ kind: e.target.value as 'manual' | 'opening' })}>
          <option value="manual">{tr('Manual journal')}</option>
          <option value="opening">{tr('Opening balances')}</option>
        </select>
      </label>
      <label className="ac-field"><span>{tr('Currency')}</span>
        <select value={f.currency} onChange={(e) => set({ currency: e.target.value })}>{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select>
      </label>
      <label className="ac-field ac-wide"><span>{tr('Description')} <b aria-hidden="true">*</b></span>
        <input required value={f.memo} maxLength={500} onChange={(e) => set({ memo: e.target.value })} placeholder={tr('What is this entry for?')} aria-invalid={!f.memo.trim()} />
      </label>
      {f.kind === 'opening' ? <p className="pk-muted ac-wide">{tr('Opening balances are dated the first day of a fiscal year. Put the difference on the opening balances account.')}</p> : null}
    </div>
  );
  const partySelect = (l: DraftLine, i: number) => (
    <select value={l.party} onChange={(e) => setLine(i, { party: e.target.value })} aria-label={tr('Customer or supplier (optional)')}>
      <option value="">{tr('None')}</option>
      {customers.length ? <optgroup label={tr('Customers')}>{customers.map((c) => <option key={c.id} value={`customer:${c.id}`}>{c.name}</option>)}</optgroup> : null}
      {suppliers.length ? <optgroup label={tr('Suppliers')}>{suppliers.map((s) => <option key={s.id} value={`supplier:${s.id}`}>{s.name}</option>)}</optgroup> : null}
    </select>
  );
  const amountInput = (l: DraftLine, i: number, sideKey: 'debit' | 'credit') => (
    <input className="ac-amt" inputMode="decimal" placeholder="0.00" value={l[sideKey]} aria-label={sideKey === 'debit' ? tr('Debit') : tr('Credit')}
      onChange={(e) => setLine(i, sideKey === 'debit' ? { debit: e.target.value, credit: e.target.value ? '' : l.credit } : { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
  );
  const grid = (
    <table className="pk-table ac-grid">
      <thead><tr>
        <th scope="col">{tr('Account')}</th><th scope="col" className="pk-num">{tr('Debit')}</th><th scope="col" className="pk-num">{tr('Credit')}</th>
        <th scope="col">{tr('Customer or supplier (optional)')}</th><th scope="col">{tr('Note')}</th><th scope="col"><span className="pk-visually-hidden">{tr('Actions')}</span></th>
      </tr></thead>
      <tbody>
        {f.lines.map((l, i) => (
          <tr key={i}>
            <td className="ac-acct"><AccountSelect accounts={accounts} value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} /></td>
            <td>{amountInput(l, i, 'debit')}</td>
            <td>{amountInput(l, i, 'credit')}</td>
            <td>{partySelect(l, i)}</td>
            <td><input value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} aria-label={tr('Note')} /></td>
            <td>{f.lines.length > 2 ? <button type="button" className="ac-x" onClick={() => removeLine(i)} aria-label={tr('Remove')}>✕</button> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const totals = (
    <div className={`ac-totals${problem === 'unbalanced' ? ' off' : ''}`} role="status">
      <div><span>{tr('Total debit')}</span><strong>{money(dr, f.currency)}</strong></div>
      <div><span>{tr('Total credit')}</span><strong>{money(cr, f.currency)}</strong></div>
      <div><span>{tr('Difference')}</span><strong>{diff === 0 ? `✓ ${tr('Balanced')}` : money(Math.abs(diff), f.currency)}</strong></div>
    </div>
  );
  const problems = [problemText, missing].filter(Boolean) as string[];
  const bar = problems.length ? (
    <div className="ac-msgbar" role="status">
      <strong>{problems.length === 1 ? tr('1 thing to fix before saving') : trf('{n} things to fix before saving', { n: problems.length })}</strong>
      <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>
  ) : null;
  const who = <p className="pk-muted">{canPost ? tr('You may post without approval (owner or head accountant).') : tr('Someone else has to approve your journal.')}</p>;
  const actions = (main = true) => (
    <>
      <button type="button" className={`pk-act${main ? ' pk-act-main' : ''}`} disabled={blocked} onClick={() => save(false)}>{tr('Save for approval')}</button>
      {canPost ? (
        <ConfirmButton label={tr('Post now')} confirmLabel={tr('Yes, post')} disabled={blocked}
          question={trf('Post {amount} now? A posted entry cannot be changed, only reversed.', { amount: money(dr, f.currency) })} onConfirm={() => save(true)} />
      ) : null}
    </>
  );
  const voucher = (
    <div className="ac-voucher">
      <p className="pk-label">{tr('How it will post')}</p>
      <table className="pk-table">
        <thead><tr><th scope="col">{tr('Account')}</th><th scope="col" className="pk-num">{tr('Debit')}</th><th scope="col" className="pk-num">{tr('Credit')}</th></tr></thead>
        <tbody>
          {[...lines].sort((a, b) => (b.debitMinor ?? 0) - (a.debitMinor ?? 0)).map((l, i) => {
            const a = acct(l.accountId);
            return (
              <tr key={i}>
                <td className={l.creditMinor ? 'ac-indent' : undefined}>{a ? accountLabel(a) : '—'}{l.memo ? <span className="pk-muted"> · {l.memo}</span> : null}</td>
                <td className="pk-num">{l.debitMinor ? money(l.debitMinor, f.currency) : ''}</td>
                <td className="pk-num">{l.creditMinor ? money(l.creditMinor, f.currency) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="pk-muted">{trf('Dated {date}. {who}', { date: f.entryDate, who: canPost ? tr('It posts when you press Post now, or after approval.') : tr('It posts after someone else approves it.') })}</p>
    </div>
  );
  const back = <Link to="/accounting/journals" className="back-link">← {tr('Manual journals')}</Link>;

  if (version === 'B') {
    // A line with a debit sits on the debit side, one with a credit on the credit side; a blank line stays where it was added.
    const sideOf = (l: DraftLine, i: number): 'debit' | 'credit' => (l.debit ? 'debit' : l.credit ? 'credit' : (blankSide[i] ?? (i % 2 === 0 ? 'debit' : 'credit')));
    const rowsOf = (k: 'debit' | 'credit') => f.lines.map((l, i) => ({ l, i })).filter(({ l, i }) => sideOf(l, i) === k);
    const addOn = (k: 'debit' | 'credit') => { setBlankSide({ ...blankSide, [f.lines.length]: k }); set({ lines: [...f.lines, blankLine()] }); };
    const removeOn = (i: number) => {
      const next: Record<number, 'debit' | 'credit'> = {};
      for (const [k, v] of Object.entries(blankSide)) { const n = Number(k); if (n !== i) next[n > i ? n - 1 : n] = v; }
      setBlankSide(next);
      removeLine(i);
    };
    const debitRows = rowsOf('debit');
    const creditRows = rowsOf('credit');
    const sideCol = (k: 'debit' | 'credit', rows: { l: DraftLine; i: number }[]) => (
      <div className="ac-side">
        <h2>{k === 'debit' ? tr('Debit') : tr('Credit')} <span className="pk-muted">{k === 'debit' ? tr('(goes into the account)') : tr('(comes out of the account)')}</span></h2>
        {rows.map(({ l, i }) => (
          <div key={i} className="ac-side-row">
            <AccountSelect accounts={accounts} value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} />
            {amountInput(l, i, k)}
            {f.lines.length > 2 ? <button type="button" className="ac-x" onClick={() => removeOn(i)} aria-label={tr('Remove')}>✕</button> : <span />}
            <details className="ac-more"><summary>{tr('More')}</summary><div className="ac-more-body">{partySelect(l, i)}<input value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} placeholder={tr('Note')} aria-label={tr('Note')} /></div></details>
          </div>
        ))}
        <button type="button" className="ac-add" onClick={() => addOn(k)}>+ {k === 'debit' ? tr('Add a debit line') : tr('Add a credit line')}</button>
        <p className="ac-side-total">{tr('Total')}: <strong>{money(k === 'debit' ? dr : cr, f.currency)}</strong></p>
      </div>
    );
    const max = Math.max(dr, cr, 1);
    return (
      <section className="page pk pk-wide ac">
        {back}
        <div className="pk-head"><div><p className="pk-kind">{tr('Manual journal')}</p><h1>{title}</h1></div></div>
        <Notice message={message} />
        {general}
        <div className="ac-sides">
          {sideCol('debit', debitRows)}
          {sideCol('credit', creditRows)}
        </div>
        <div className="ac-scale" role="status" aria-label={tr('Balance')}>
          <span className="ac-scale-bar"><i style={{ width: `${(dr / max) * 100}%` }} /></span>
          <strong>{diff === 0 && dr > 0 ? `✓ ${tr('Balanced')}` : diff > 0 ? trf('The credit side is short by {amount}', { amount: money(diff, f.currency) }) : diff < 0 ? trf('The debit side is short by {amount}', { amount: money(-diff, f.currency) }) : tr('Enter the amounts')}</strong>
          <span className="ac-scale-bar ac-scale-cr"><i style={{ width: `${(cr / max) * 100}%` }} /></span>
        </div>
        {bar}
        <div className="ac-foot">{who}<span className="pk-bar-gap" /><button type="button" className="pk-act" onClick={() => navigate('/accounting/journals')}>{tr('Cancel')}</button>{actions()}</div>
      </section>
    );
  }

  if (version === 'C' && !split && f.lines.length <= 2) {
    const toL = f.lines[0] ?? blankLine();
    const fromL = f.lines[1] ?? blankLine();
    const amount = toL.debit || fromL.credit;
    const setAmount = (v: string) => set({ lines: [{ ...toL, debit: v, credit: '' }, { ...fromL, credit: v, debit: '' }] });
    const from = acct(fromL.accountId);
    const to = acct(toL.accountId);
    return (
      <section className="page pk ac ac-simple">
        {back}
        <div className="pk-head"><div><p className="pk-kind">{tr('Manual journal')}</p><h1>{title}</h1></div></div>
        <Notice message={message} />
        <div className="ac-sentence">
          <label className="ac-field"><span>{tr('Amount')}</span><input className="ac-amt ac-big" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <span className="ac-word">{tr('from')}</span>
          <div className="ac-field"><span>{tr('From account (credit)')}</span><AccountSelect accounts={accounts} value={fromL.accountId} onChange={(v) => set({ lines: [toL, { ...fromL, accountId: v }] })} label={tr('From account (credit)')} /></div>
          <span className="ac-word">{tr('to')}</span>
          <div className="ac-field"><span>{tr('To account (debit)')}</span><AccountSelect accounts={accounts} value={toL.accountId} onChange={(v) => set({ lines: [{ ...toL, accountId: v }, fromL] })} label={tr('To account (debit)')} /></div>
        </div>
        <div className="ac-general ac-general-c">
          <label className="ac-field"><span>{tr('Date')}</span><DateInput value={f.entryDate} onChange={(e) => set({ entryDate: e.target.value })} /></label>
          <label className="ac-field ac-wide"><span>{tr('Description')} <b aria-hidden="true">*</b></span><input required value={f.memo} maxLength={500} onChange={(e) => set({ memo: e.target.value })} placeholder={tr('What is this entry for?')} /></label>
        </div>
        <p className="ac-plain" role="status">
          {from && to && amount
            ? trf('{amount} leaves {from} and goes into {to}.', { amount: money(Math.round(Number(amount) * 100) || 0, f.currency), from: accountLabel(from), to: accountLabel(to) })
            : tr('Choose the amount and the two accounts. The entry has one debit and one credit.')}
        </p>
        <button type="button" className="ac-add" onClick={() => { setSplit(true); if (f.lines.length < 3) set({ lines: [...f.lines, blankLine()] }); }}>+ {tr('Split into more lines')}</button>
        {bar}
        <div className="ac-foot">{who}<span className="pk-bar-gap" /><button type="button" className="pk-act" onClick={() => navigate('/accounting/journals')}>{tr('Cancel')}</button>{actions()}</div>
      </section>
    );
  }

  // A (and C after "Split into more lines")
  return (
    <section className="page pk pk-wide ac">
      {back}
      <div className="pk-head"><div><p className="pk-kind">{tr('Manual journal')}</p><h1>{title}</h1></div>{existing ? <span className="pk-muted">{tr('Draft')}</span> : null}</div>
      <div className="pk-bar" role="toolbar" aria-label={tr('Actions')}>
        {actions()}
        <button type="button" className="pk-act" aria-pressed={preview} onClick={() => setPreview(!preview)} disabled={!lines.length}>{preview ? tr('Hide the preview') : tr('Preview posting')}</button>
        <span className="pk-bar-gap" />
        <button type="button" className="pk-act" onClick={() => navigate('/accounting/journals')}>{tr('Cancel')}</button>
      </div>
      <Notice message={message} />
      {bar}
      <section className="pk-section"><h2>{tr('General')}</h2>{general}</section>
      <section className="pk-section">
        <div className="ac-lines-head"><h2>{tr('Lines')}</h2><button type="button" className="ac-add" onClick={() => set({ lines: [...f.lines, blankLine()] })}>+ {tr('Add a line')}</button></div>
        <div className="pk-table-wrap">{grid}</div>
        {totals}
      </section>
      {preview ? voucher : null}
      {who}
    </section>
  );
}
