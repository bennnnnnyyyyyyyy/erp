import { useState } from 'react';
import type { ItemStatementLine, PartyStatementLine } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api, apiDownload } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { tr } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Notice, firstOfYear, money, moveLabel, side, sourceLabel, sourcePath, today, useNotice } from '../accounting/common';

// Statement of account (كشف حساب; TREASURY_PLAN.md S1, sql/052) for a customer, a supplier or an item, for a period: opening
// balance, lines with a running balance, closing balance. Printable (the browser's print) and CSV. Owner and admin only.

type Named = { id: string; code?: string; name: string };
type Kind = 'customer' | 'supplier' | 'item';
type Item = { id: string; sku: string; name: string };

export function StatementsPage() {
  const session = useSession();
  const has = (m: string) => session.modules.includes(m);
  const customers = useLoad(() => (has('sales') ? api<Named[]>('/v1/sales/customers') : Promise.resolve([] as Named[])));
  const suppliers = useLoad(() => (has('purchasing') ? api<Named[]>('/v1/purchasing/suppliers') : Promise.resolve([] as Named[])));
  const items = useLoad(() => (has('inventory') ? api<Item[]>('/v1/inventory/items') : Promise.resolve([] as Item[])));
  const { message, busy, run } = useNotice();
  const [kind, setKind] = useState<Kind>('customer');
  const [id, setId] = useState('');
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(today());
  const [shown, setShown] = useState<{ kind: Kind; id: string; from: string; to: string } | null>(null);
  const accountingOn = has('accounting');

  const path = (s: { kind: Kind; id: string; from: string; to: string }) =>
    s.kind === 'item'
      ? `/v1/finance/statements/item?itemId=${s.id}&from=${s.from}&to=${s.to}`
      : `/v1/finance/statements/party?type=${s.kind}&id=${s.id}&from=${s.from}&to=${s.to}`;
  const party = useLoad(() => (shown && shown.kind !== 'item' ? api<{ currency: string; lines: PartyStatementLine[] }>(path(shown)) : Promise.resolve(null)));
  const item = useLoad(() => (shown && shown.kind === 'item' ? api<{ currency: string; lines: ItemStatementLine[] }>(path(shown)) : Promise.resolve(null)));

  if (!customers.data || !suppliers.data || !items.data) return <section className="page"><Loading error={customers.error ?? suppliers.error ?? items.error} /></section>;
  const options: Named[] = kind === 'customer' ? customers.data : kind === 'supplier' ? suppliers.data : items.data.map((i) => ({ id: i.id, code: i.sku, name: i.name }));
  const chosen = options.find((o) => o.id === id);
  const title = shown ? [...customers.data, ...suppliers.data, ...items.data.map((i) => ({ id: i.id, code: i.sku, name: i.name }))].find((o) => o.id === shown.id) : null;
  const show = () => { const s = { kind, id, from, to }; setShown(s); party.reload(); item.reload(); };

  return (
    <section className="page wide">
      <h1>{tr('Statement of account')}</h1>
      <p className="muted">{tr('For a customer or supplier: what they owe or are owed, line by line, with a running balance. For an item: quantities in and out, with their value.')}</p>
      <Notice message={message} />
      <div className="form-row no-print">
        <label>{tr('For')}
          <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setId(''); }}>
            {has('sales') ? <option value="customer">{tr('Customer')}</option> : null}
            {has('purchasing') ? <option value="supplier">{tr('Supplier')}</option> : null}
            {has('inventory') ? <option value="item">{tr('Item')}</option> : null}
          </select>
        </label>
        <label>{kind === 'customer' ? tr('Customer') : kind === 'supplier' ? tr('Supplier') : tr('Item')}
          <select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">{tr('Choose…')}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} · ${o.name}` : o.name}</option>)}
          </select>
        </label>
        <label>{tr('From')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{tr('To')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button variant="outline" disabled={!chosen || !from || !to || to < from} onClick={show}>{tr('Show')}</Button>
        {shown ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
              await apiDownload(`${path(shown)}&format=csv`, `statement-${shown.from}-to-${shown.to}.csv`);
              return tr('Downloaded.');
            })}>{tr('Download CSV')}</Button>
            <Button variant="ghost" onClick={() => window.print()}>{tr('Print')}</Button>
          </>
        ) : null}
      </div>
      {kind !== 'item' && !accountingOn ? <p className="muted small">{tr('Customer and supplier statements come from the books: switch accounting on first.')}</p> : null}

      {shown && title ? (
        <h2>{title.code ? `${title.code} · ` : ''}{title.name} <span className="muted small">{formatDay(shown.from, session.org)} – {formatDay(shown.to, session.org)}</span></h2>
      ) : null}

      {shown && shown.kind !== 'item' ? (!party.data ? <Loading error={party.error} /> : (
        <div className="table-wrap"><table><thead><tr>
          <th scope="col">{tr('Date')}</th><th scope="col">{tr('Document')}</th><th scope="col">{tr('Description')}</th><th scope="col" className="right">{tr('Debit')}</th><th scope="col" className="right">{tr('Credit')}</th><th scope="col" className="right">{tr('Balance')}</th>
        </tr></thead><tbody>
          {party.data.lines.map((l, i) => {
            const p = l.sourceType && l.sourceId ? sourcePath(l.sourceType, l.sourceId) : null;
            return (
              <tr key={l.lineId ?? `o${i}`}>
                <td className="nowrap">{formatDay(l.entryDate, session.org)}</td>
                <td>{l.isOpening ? null : p ? <Link to={p}>{sourceLabel(l.sourceType ?? '')}</Link> : sourceLabel(l.sourceType ?? '')}</td>
                <td>{l.isOpening ? <strong>{tr('Opening balance')}</strong> : l.memo}</td>
                <td className="right">{side(l.debitMinor, party.data!.currency)}</td>
                <td className="right">{side(l.creditMinor, party.data!.currency)}</td>
                <td className="right">{money(l.balanceMinor, party.data!.currency)}</td>
              </tr>
            );
          })}
          <tr><th scope="row" colSpan={5}>{tr('Closing balance')}</th><td className="right"><strong>{money(party.data.lines.at(-1)?.balanceMinor ?? 0, party.data.currency)}</strong></td></tr>
        </tbody></table></div>
      )) : null}

      {shown && shown.kind === 'item' ? (!item.data ? <Loading error={item.error} /> : (
        <>
          <div className="table-wrap"><table><thead><tr>
            <th scope="col">{tr('Date')}</th><th scope="col">{tr('Movement')}</th><th scope="col">{tr('Reference')}</th><th scope="col" className="right">{tr('In')}</th><th scope="col" className="right">{tr('Out')}</th>
            <th scope="col" className="right">{tr('Unit cost')}</th><th scope="col" className="right">{tr('Value')}</th><th scope="col" className="right">{tr('Quantity on hand')}</th><th scope="col" className="right">{tr('Stock value')}</th>
          </tr></thead><tbody>
            {item.data.lines.map((l, i) => (
              <tr key={l.moveId ?? `o${i}`}>
                <td className="nowrap">{formatDay(l.moveDate, session.org)}</td>
                <td>{l.isOpening ? <strong>{tr('Opening balance')}</strong> : moveLabel(l.kind)}</td>
                <td>{l.ref}</td>
                <td className="right">{l.qtyIn ?? ''}</td>
                <td className="right">{l.qtyOut ?? ''}</td>
                <td className="right">{l.unitCostMinor === null ? '' : money(l.unitCostMinor, item.data!.currency)}</td>
                <td className="right">{l.isOpening ? '' : l.costKnown ? money(l.valueMinor ?? 0, item.data!.currency) : <span className="muted">{tr('no cost')}</span>}</td>
                <td className="right">{l.balanceQty}</td>
                <td className="right">{money(l.balanceValueMinor, item.data!.currency)}</td>
              </tr>
            ))}
          </tbody></table></div>
          {item.data.lines.some((l) => !l.isOpening && !l.costKnown) ? <p className="muted small">{tr('Movements marked "no cost" were recorded without a cost, so the stock value leaves them out.')}</p> : null}
        </>
      )) : null}
    </section>
  );
}
