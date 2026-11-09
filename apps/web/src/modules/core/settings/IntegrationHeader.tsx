import { useState } from 'react';
import { Link } from '../../../lib/router';
import { tr } from '../../../lib/i18n';
import { STATUS_LABEL, STATUS_PILL, type ConnectionStatus } from './integrationStatus';

// The logo, name, status and "where it is used" at the top of one integration in Settings > Integrations.
// Settings is where an integration is connected; the apps are where it is used, so each one links to the place it feeds.

/**
 * Logo files in apps/web/public/integrations/. A provider without a file, or whose file fails to load, shows its first letter (Fawry and
 * Bosta until files are supplied; Email is not a brand). Sources, 9 Nov 2026: Simple Icons (CC0 files; the marks remain their owners'
 * trademarks) for all but Paymob, whose file is from paymob.com. Each is used only to name the service we connect to.
 */
const LOGOS: Record<string, string> = {
  paymob: 'paymob.svg',
  shopify: 'shopify.svg',
  slack: 'slack.svg',
  teams: 'teams.svg',
  telegram: 'telegram.svg',
  openai: 'openai.svg',
  elevenlabs: 'elevenlabs.svg',
  ollama: 'ollama.svg',
};

const USED_IN: Record<string, { label: string; to: string }> = {
  paymob: { label: 'Pay now links on sales invoices', to: '/sales/invoices' },
  fawry: { label: 'Pay now links on sales invoices', to: '/sales/invoices' },
  bosta: { label: 'Shipments on sales orders', to: '/sales' },
  shopify: { label: 'Online orders in Sales', to: '/sales/online-orders' },
  email: { label: 'Copies of your messages', to: '/messaging' },
  slack: { label: 'Copies of your messages', to: '/messaging' },
  teams: { label: 'Copies of your messages', to: '/messaging' },
  telegram: { label: 'Copies of your messages', to: '/messaging' },
};

export function IntegrationLogo({ kind, name, size = 'md' }: { kind: string; name: string; size?: 'sm' | 'md' }) {
  const [failed, setFailed] = useState(false);
  const file = LOGOS[kind];
  return (
    <span className={`intg-logo intg-logo-${size}`} aria-hidden="true">
      {file && !failed ? <img src={`/integrations/${file}`} alt="" onError={() => setFailed(true)} /> : name.charAt(0).toUpperCase()}
    </span>
  );
}

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  return <span className={`pill ${STATUS_PILL[status]}`}>{tr(STATUS_LABEL[status])}</span>;
}

export function IntegrationHeader({ kind, name, summary, status }: { kind: string; name: string; summary: string; status: ConnectionStatus }) {
  const used = USED_IN[kind];
  return (
    <header className="intg-head">
      <IntegrationLogo kind={kind} name={name} />
      <div className="intg-head-text">
        <h2>{name}</h2>
        <p className="muted small">{summary}</p>
        {used ? (
          <p className="small">
            {tr('Used in')}: <Link to={used.to}>{tr(used.label)}</Link>
          </p>
        ) : null}
      </div>
      <StatusBadge status={status} />
    </header>
  );
}
