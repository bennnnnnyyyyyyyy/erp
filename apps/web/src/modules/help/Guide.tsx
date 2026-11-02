import { hasPermission } from '@erp/shared';
import { demoMode } from '../../lib/demo';
import { Link } from '../../lib/router';
import { useSession } from '../../session';
import { SUITE_ORDER, visibleApps } from '../registry';
import { Step } from './GettingStarted';

// The guide: where things are, a five-step path through what the system does, and what is not ready yet. Unlike the getting-started
// tutorial (new companies only), the guide is shown in every organization, including the sample companies. The list of apps is live:
// it shows only the apps this person can open.

export function GuidePage() {
  const session = useSession();
  const apps = visibleApps(session).filter((a) => a.key !== 'guide');
  const suites = SUITE_ORDER.map((suite) => ({ suite, apps: apps.filter((a) => a.suite === suite) })).filter((s) => s.apps.length > 0);
  const has = (key: string) => apps.some((a) => a.key === key);
  const hasAudit = apps.some((a) => a.key === 'settings' && a.pages.some((p) => p.path === '/audit'));

  return (
    <section className="page">
      <h1>Guide</h1>
      <p className="muted">How to find your way around, and a five-step path that shows what this system does. It is the same for everyone: you only see the apps you are allowed to use.</p>

      <h2 className="related">Where everything is</h2>
      <p className="muted small">Open any app from the home page, or from the links below. Inside an app, the menu on the left lists its pages.</p>
      {suites.map(({ suite, apps: group }) => (
        <div key={suite} className="stack">
          <strong>{suite}</strong>
          <ul className="plain-list">
            {group.map((a) => (
              <li key={a.key}>
                <Link to={a.basePath}>{a.name}</Link> <span className="muted">: {a.description}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <h2 className="related">Five steps to see how it works</h2>
      <p className="muted small">Use two people if you can: one asks for stock, a manager approves. The same person cannot do both.</p>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        <Step n={1} title="Start at the home page" to="/" toLabel="Go to the home page">
          Owners and managers see whether the business is making or losing money, what is owed, what is waiting for a decision, and what is about to expire or run out. Every card shows what it covers and for which period.
        </Step>
        <Step n={2} title="Ask for stock" to={has('inventory') && hasPermission(session.permissions, 'inventory.request.create') ? '/inventory/requests/new' : undefined} toLabel="New stock request">
          A staff member asks for stock to leave a warehouse. The stock is set aside (reserved) straight away, but nothing leaves yet.
        </Step>
        <Step n={3} title="Approve it, as a different person" to={has('inventory') ? '/inventory/requests' : undefined} toLabel="Stock requests">
          A manager approves or rejects. The person who asked cannot approve their own request: the database refuses it, not just the screen. Only after approval can the stock be handed out.
        </Step>
        <Step n={4} title="Check the audit log" to={hasAudit ? '/settings/audit' : undefined} toLabel="Audit log">
          Every approval and every stock movement is written to a log in the same step, and nobody can edit or delete it. It shows who did what, and when.
        </Step>
        <Step n={5} title="See what will run out" to={has('inventory') && !demoMode ? '/inventory/forecast' : undefined} toLabel="Stock forecast">
          The forecast uses the company's own sales history to say when each item will run out, and says so when it has too little history to be sure. Alerts can tell the right people before it happens.
        </Step>
      </ol>

      <h2 className="related">What is not ready yet</h2>
      <p className="muted small">So nobody is surprised: these are planned or partly built.</p>
      <ul className="plain-list">
        <li><b>Approvals by WhatsApp and by voice.</b> Designed and partly built, but not tested on a real phone. Approvals today are in the app.</li>
        <li><b>Arabic.</b> Menus only so far. Each person can choose English or Arabic in Settings; the other screens stay in English until they are translated and reviewed.</li>
        <li><b>Accounting.</b> The profit figures are a management view (no VAT, cost is the average cost of stock). It is not a full ledger, tax return or Egypt e-invoicing.</li>
        <li><b>Manufacturing.</b> No bill of materials or production orders yet, so profit for a factory is approximate.</li>
        <li><b>Import and returns.</b> Importing items from a file, and customer or supplier returns and credit notes, are planned.</li>
        <li><b>Sample data.</b> In the sample companies everything is invented and clearly marked.</li>
      </ul>
    </section>
  );
}
