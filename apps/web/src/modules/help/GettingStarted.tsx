import { useEffect, useState, type ReactNode } from 'react';
import { hasPermission } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Link, navigate } from '../../lib/router';
import { useReloadSession, useSession } from '../../session';

// The getting-started tutorial. It exists only in companies that signed up through the app (flag `show_tutorial`, sql/032): the sample
// companies never have it. The checklist is live (it looks at what the company has created so far); the steps describe screens that
// exist today, and the last section says plainly what is not ready yet. Owners and admins can hide it (and bring it back in
// Settings > General).

/** How many records a list endpoint returns; null = the person may not see it or it is not available. */
function useCount(path: string, enabled: boolean): number | null | undefined {
  const [n, setN] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return setN(null);
    let live = true;
    api<unknown[]>(path).then((rows) => live && setN(Array.isArray(rows) ? rows.length : null)).catch(() => live && setN(null));
    return () => { live = false; };
  }, [path, enabled]);
  return n;
}

function Step({ n, title, to, toLabel, children }: { n: number; title: string; to?: string; toLabel?: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">{n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-base font-semibold">{title}</h3>
        <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
        {to && <p className="mt-3"><Link to={to}>{toLabel ?? 'Open it'} →</Link></p>}
      </div>
    </li>
  );
}

export function GettingStartedPage() {
  const session = useSession();
  const reload = useReloadSession();
  const can = (p: string) => hasPermission(session.permissions, p);
  const canHide = can('core.org.manage');
  const warehouses = useCount('/v1/inventory/warehouses', can('inventory.items.read'));
  const items = useCount('/v1/inventory/items', can('inventory.items.read'));
  const team = useCount('/v1/core/members', can('core.users.read'));
  const suppliers = useCount('/v1/purchasing/suppliers', session.modules.includes('purchasing'));
  const customers = useCount('/v1/sales/customers', can('sales.customers.read'));
  const rules = useCount('/v1/alerts/rules', can('alerts.rules.view'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checklist: { label: string; done: boolean | null; to: string }[] = [
    { label: 'Company created', done: true, to: '/settings' },
    { label: 'Add your first warehouse', done: warehouses == null ? null : warehouses > 0, to: '/inventory' },
    { label: 'Add your first item', done: items == null ? null : items > 0, to: '/inventory' },
    { label: 'Invite a colleague', done: team == null ? null : team > 1, to: '/settings/users' },
    { label: 'Add a supplier', done: suppliers == null ? null : suppliers > 0, to: '/purchasing/suppliers' },
    { label: 'Add a customer', done: customers == null ? null : customers > 0, to: '/sales/customers' },
    { label: 'Set up an alert', done: rules == null ? null : rules > 0, to: '/alerts' },
  ];
  const finished = checklist.filter((c) => c.done === true).length;

  async function hide() {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/core/org/tutorial', { method: 'POST', body: JSON.stringify({ show: false }) });
      reload();
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <h1>Getting started</h1>
      <p className="muted">A short guide to running {session.org?.name ?? 'your company'} in this system, in the order most companies set it up. Nothing here changes anything by itself: each step opens the real screen.</p>

      <div className="mt-5 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-base font-semibold">Your setup</h2>
          <span className="text-sm text-muted-foreground">{finished} of {checklist.length} done</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={finished} aria-label="Setup progress">
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${(finished / checklist.length) * 100}%` }} />
        </div>
        <ul className="m-0 mt-4 grid list-none gap-2 p-0 sm:grid-cols-2">
          {checklist.map((c) => (
            <li key={c.label}>
              <Link to={c.to} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-foreground no-underline hover:bg-accent">
                <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border text-xs', c.done ? 'border-success bg-success text-white' : 'border-border text-transparent')} aria-hidden="true">✓</span>
                <span className={c.done ? 'text-muted-foreground line-through' : ''}>{c.label}</span>
                <span className="sr-only">{c.done ? 'done' : c.done === null ? 'not available to you' : 'not done yet'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <ol className="m-0 mt-6 flex list-none flex-col gap-4 p-0">
        <Step n={1} title="Make it yours" to="/settings" toLabel="Open Settings">
          Check the company name, currency and time zone, and the language everyone will see (Settings → General). The language, currency and time zone were set when you signed up.
          Roles: an <b>owner</b> or <b>admin</b> manages everything; <b>staff</b> raise requests, receive goods and do tasks; a <b>viewer</b> can only look.
        </Step>
        <Step n={2} title="Invite your team" to="/settings/users" toLabel="Open Users">
          Add colleagues by email (Settings → Users). Someone who already has an account gets an invitation they must accept; a new person gets a link to set a password. Put whoever buys stock in the <b>Purchasing</b> team later (step 8).
        </Step>
        <Step n={3} title="Add a warehouse and your items" to="/inventory" toLabel="Open Inventory">
          A warehouse is any place you keep stock. On Inventory → Stock on hand press <b>Add warehouse</b>, then <b>Add item</b> (code, name, unit, and the opening quantity if you already have stock). Every movement afterwards is written to a ledger that cannot be edited: that is what makes the numbers trustworthy.
        </Step>
        <Step n={4} title="Move stock out safely" to="/inventory/requests" toLabel="Open Stock requests">
          Nothing leaves the warehouse without a request. Staff press <b>New request</b>; a manager (someone other than the requester) approves or rejects; then stock is issued. Stock is reserved the moment a request is raised, so two people cannot take the same units. For big quantities you can require more than one approver (Approval policies).
        </Step>
        <Step n={5} title="Buy and receive" to="/purchasing" toLabel="Open Purchasing">
          Add suppliers, raise a <b>purchase order</b>, and press <b>Receive</b> when the goods arrive: the stock goes up and each item's average cost is updated. Record the supplier's bill under Supplier invoices; it is checked against what you actually received.
        </Step>
        <Step n={6} title="Sell and invoice" to="/sales" toLabel="Open Sales">
          Add customers, create a <b>sales order</b>, press <b>Request stock from warehouse</b> (it goes through the same approval as step 4), and once the stock is issued the order counts as delivered. Then create the invoice under Customer invoices: you can invoice part of an order, never more than was delivered, and a wrong invoice is voided, not edited.
        </Step>
        <Step n={7} title="Know if you are making or losing money" to="/finance/overview" toLabel="Open Profit overview">
          Record expenses and payments in <b>Finance</b> (owners and admins only). The home page then shows, in plain words, whether last month made or lost money, who owes you, what you owe, stock value and what is about to expire. Cost is the average cost of your stock; VAT is not included.
        </Step>
        <Step n={8} title="Let the system watch for you" to="/alerts" toLabel="Open Alerts">
          Alerts tell the right people when something needs attention: an item is low, will run out within N days (from your own sales history), a batch is about to expire, an invoice is late, or the month is losing money. Create teams (Purchasing, Warehouse, Management), then add rules and choose who is told. One digest message per person, not one per item.
        </Step>
        <Step n={9} title="Things that expire" to="/inventory/batches" toLabel="Open Batches and expiry">
          For creams, oils, food or anything with a date: turn on <b>batch tracking</b> for that item. You receive it in batches with an expiry date, the system issues the batch that expires first, and an expired or quarantined batch is never issued. Name your storage places (for example a cold room, 2 to 8 °C): an item that needs the cold room cannot be received into an ambient store.
        </Step>
      </ol>

      <div className="mt-6 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
        <h2 className="m-0 text-base font-semibold">What is not ready yet</h2>
        <ul className="mt-2 list-disc ps-5 text-sm leading-relaxed text-muted-foreground">
          <li><b>Approving and assigning tasks by WhatsApp or voice</b> is built in the database but not yet connected to WhatsApp: today alerts and approvals arrive inside the app only.</li>
          <li><b>Manufacturing</b> (recipes and production orders) is not built, so profit for a factory is approximate until it is.</li>
          <li><b>Arabic</b> covers the menus only so far, and it is a first draft; the rest of the screens are in English.</li>
          <li><b>Tax and e-invoicing</b> (VAT, the tax authority's electronic invoice) are not included. This is a management view, not statutory accounts.</li>
          <li>No printing or PDF of invoices yet.</li>
        </ul>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {canHide ? <Button variant="outline" onClick={hide} disabled={busy}>Hide this guide</Button> : null}
        <span className="text-sm text-muted-foreground">{canHide ? 'You can bring it back any time in Settings → General.' : 'An owner or admin can hide this guide.'}</span>
      </div>
      {error && <p className="error mt-3" role="alert">{error}</p>}
    </section>
  );
}
