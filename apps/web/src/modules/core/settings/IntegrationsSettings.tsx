import { useEffect, useState } from 'react';
import { AI_NOTICE_VERSION, hasPermission, INTEGRATION_MESSAGE_KINDS, PROVIDERS, type AiStatus, type CbeRate, type FxRate, type IntegrationKind, type IntegrationSettings, type ProviderDef, type ProviderSettings } from '@erp/shared';
import { ConfirmButton } from '../../../components/FormToggle';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { formatDateTime, formatDay } from '../../../lib/format';
import { tr, trf } from '../../../lib/i18n';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';
import { Notice, useNotice } from '../../accounting/common';
import { AiTry } from './AiTry';
import { IntegrationHeader, IntegrationLogo, StatusBadge } from './IntegrationHeader';
import { connectionStatus, countStatuses, needsAttention, STATUS_LABEL, type Connection, type ConnectionStatus } from './integrationStatus';
import { AiNotice, ProviderCard } from './ProvidersSettings';

// Settings > Integrations (INTEGRATIONS_PLAN.md wave 1; sql/053). Owners and admins. Each integration starts "simulated": messages
// are marked delivered but nothing leaves the system, so a company can try it safely. Webhook URLs are write-only (a hint is shown).
// A channel only delivers: approving still happens in the app.
// Layout (Ben, 9 Nov 2026): a list on the left, one integration on the right, an overview first. This page only CONNECTS an integration;
// the apps use it (Pay now links on sales invoices, shipments on sales orders, online orders in Sales, copies of messages).

const NAME: Record<IntegrationKind, string> = { email: 'Email', slack: 'Slack', teams: 'Microsoft Teams', telegram: 'Telegram', google_chat: 'Google Chat' };
const HELP: Record<IntegrationKind, string> = {
  email: 'Sends a copy of the chosen messages to each person by email.',
  slack: 'Posts the chosen messages to one Slack channel. In Slack: create an app, turn on Incoming Webhooks, add it to a channel, and paste the webhook URL here.',
  teams: 'Posts the chosen messages to one Teams channel. In Teams: on the channel, open Workflows, choose "Send webhook alerts to a channel", and paste the URL it gives you here.',
  google_chat: 'Posts the chosen messages to one Google Chat space. In Google Chat: open the space, choose Apps & integrations, then Webhooks, add one, and paste the webhook URL here (it starts with https://chat.googleapis.com/).',
  telegram: 'Sends a copy of the chosen messages on Telegram to each person who has linked it (Messages → Connect WhatsApp and Telegram). Free; each message has an "Open in the app" button.',
};
const KIND_LABEL: Record<string, string> = {
  approval_request: 'Approval requests',
  decision: 'Decisions',
  task_assigned: 'Tasks assigned',
  reminder: 'Reminders',
  escalation: 'Escalations',
  alert: 'Alerts',
  info: 'Other notices',
};

function IntegrationCard({ item, canManage, onChanged }: { item: IntegrationSettings; canManage: boolean; onChanged: () => void }) {
  const session = useSession();
  const { message, busy, run } = useNotice();
  const [url, setUrl] = useState('');
  const save = (patch: Partial<Pick<IntegrationSettings, 'enabled' | 'mode' | 'messageKinds'>>) =>
    run(async () => {
      await api(`/v1/core/integrations/${item.kind}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: item.enabled, mode: item.mode, messageKinds: item.messageKinds, ...patch }),
      });
      return tr('Saved.');
    }, onChanged);
  const toggleKind = (k: string) => save({ messageKinds: item.messageKinds.includes(k) ? item.messageKinds.filter((x) => x !== k) : [...item.messageKinds, k] });

  return (
    <div className="form-card stack intg-detail">
      <IntegrationHeader kind={item.kind} name={tr(NAME[item.kind])} summary={tr(HELP[item.kind])} status={connectionStatus(item)} />
      {item.enabled && item.mode === 'simulated' ? <p className="muted small">{tr('Test mode: nothing is really sent.')}</p> : null}
      <Notice message={message} />

      {item.needsSecret ? (
        <div className="stack">
          <p className="small">{item.secretHint ? trf('Webhook URL saved (ends {hint}).', { hint: item.secretHint }) : tr('No webhook URL saved yet.')}</p>
          {canManage ? (
            <div className="form-row">
              <label>{tr('Webhook URL')}<input type="url" autoComplete="off" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
              <Button variant="outline" disabled={busy || !url.trim().startsWith('https://')} onClick={() => run(async () => {
                await api(`/v1/core/integrations/${item.kind}/secret`, { method: 'PUT', body: JSON.stringify({ url }) });
                setUrl('');
                return tr('Webhook URL saved. It cannot be shown again.');
              }, onChanged)}>{item.secretHint ? tr('Replace URL') : tr('Save URL')}</Button>
              {item.secretHint ? (
                <ConfirmButton label={tr('Remove URL')} confirmLabel={tr('Yes, remove')} question={tr('Remove the webhook URL? The integration switches off.')} disabled={busy}
                  onConfirm={() => run(async () => { await api(`/v1/core/integrations/${item.kind}/secret`, { method: 'DELETE' }); return tr('Removed.'); }, onChanged)} />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <fieldset className="stack" disabled={!canManage || busy}>
        <legend className="small">{tr('Messages to send')}</legend>
        <div className="flex flex-wrap gap-2">
          {INTEGRATION_MESSAGE_KINDS.map((k) => (
            <label key={k} className="flex items-center gap-2 small">
              <input type="checkbox" checked={item.messageKinds.includes(k)} onChange={() => toggleKind(k)} />
              {tr(KIND_LABEL[k] ?? k)}
            </label>
          ))}
        </div>
      </fieldset>

      {canManage ? (
        <div className="form-row">
          <Button variant={item.enabled ? 'outline' : 'default'} disabled={busy} onClick={() => save({ enabled: !item.enabled })}>{item.enabled ? tr('Switch off') : tr('Switch on')}</Button>
          {item.mode === 'simulated' ? (
            <ConfirmButton label={tr('Go live')} confirmLabel={tr('Yes, go live')} question={tr('Go live? Messages will really be sent from now on.')} disabled={busy || !item.liveAvailable}
              onConfirm={() => save({ mode: 'live' })} />
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => save({ mode: 'simulated' })}>{tr('Back to test mode')}</Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
            await api(`/v1/core/integrations/${item.kind}/test`, { method: 'POST' });
            return item.kind === 'email' ? tr('A test email is queued to you; it goes out within five minutes (Messages → Message outbox).') : tr('A test message is queued; it goes out within five minutes (Messages → Message outbox).');
          }, onChanged)}>{tr('Send a test')}</Button>
        </div>
      ) : null}
      {!item.liveAvailable && item.mode === 'simulated' ? (
        <p className="muted small">{item.needsSecret ? tr('Save a webhook URL to go live.') : tr('Going live is not available on this server yet. Contact support to switch it on.')}</p>
      ) : null}
      {item.lastStatus ? (
        <p className={item.lastStatus === 'failed' ? 'error small' : 'muted small'}>
          {item.lastStatus === 'sent' ? tr('Last delivery worked') : tr('Last delivery failed')}
          {item.lastDeliveryAt ? ` · ${formatDateTime(item.lastDeliveryAt, session.org)}` : ''}
          {item.lastError ? ` · ${item.lastError}` : ''}
        </p>
      ) : null}
    </div>
  );
}

function ExchangeRates() {
  const session = useSession();
  const rates = useLoad(() => api<FxRate[]>('/v1/core/fx/today'));
  return (
    <div className="form-card stack intg-detail">
      <h2>{tr('Exchange rates')}</h2>
      <p className="muted small">{tr('Daily rates from central banks, saved once a day. For tax and accounting, ask your accountant which official rate applies.')}</p>
      {!rates.data ? <Loading error={rates.error} rows={2} /> : rates.data.length ? (
        <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Currency')}</th><th scope="col" className="right">{trf('In {currency}', { currency: session.org?.defaultCurrency ?? '' })}</th><th scope="col">{tr('Date')}</th></tr></thead><tbody>
          {rates.data.map((r) => <tr key={r.from}><td>{r.from}</td><td className="right">{r.rate.toFixed(4)}</td><td>{formatDay(r.rateDate, session.org)}</td></tr>)}
        </tbody></table></div>
      ) : <p className="muted small">{tr('No rates saved yet; they arrive with the next scheduled run.')}</p>}
      <CentralBankRates />
    </div>
  );
}

// Central Bank of Egypt buy and sell rates, SIMULATED (apps/api/src/lib/rates/cbe.ts): worked out from the daily rate above, never
// saved, never used to convert anything. Live rates wait for the source and for the company's choice of buy, sell or mid.
function CentralBankRates() {
  const session = useSession();
  const rates = useLoad(() => api<CbeRate[]>('/v1/core/fx/cbe'));
  return (
    <section className="stack" aria-labelledby="cbe-rates">
      <h3 id="cbe-rates">
        {tr('Central Bank of Egypt')} <span className="badge">{tr('SIMULATED')}</span>
      </h3>
      <p className="muted small">
        {tr('Practice numbers only: worked out from the daily rate above, not the Central Bank’s own figures. They are not saved and nothing is converted with them. Live rates come later.')}
      </p>
      {!rates.data ? <Loading error={rates.error} rows={2} /> : rates.data.length ? (
        <div className="table-wrap"><table><thead><tr>
          <th scope="col">{tr('Currency')}</th>
          <th scope="col" className="right">{tr('Buy (EGP)')}</th>
          <th scope="col" className="right">{tr('Sell (EGP)')}</th>
          <th scope="col">{tr('Date')}</th>
        </tr></thead><tbody>
          {rates.data.map((r) => (
            <tr key={r.currency}>
              <td>{r.currency}</td>
              <td className="right">{r.buy.toFixed(4)}</td>
              <td className="right">{r.sell.toFixed(4)}</td>
              <td>{formatDay(r.rateDate, session.org)}</td>
            </tr>
          ))}
        </tbody></table></div>
      ) : <p className="muted small">{tr('No rates saved yet; they arrive with the next scheduled run.')}</p>}
    </section>
  );
}

function Overview({ connections, aiNoticeNeeded, onOpen }: { connections: Connection[]; aiNoticeNeeded: boolean; onOpen: (key: string) => void }) {
  const counts = countStatuses(connections);
  const attention = needsAttention(connections);
  const summary: { status: ConnectionStatus; n: number }[] = [
    { status: 'live', n: counts.live },
    { status: 'test', n: counts.test },
    { status: 'problem', n: counts.problem },
    { status: 'off', n: counts.off },
  ];
  return (
    <div className="stack intg-detail">
      <div className="intg-summary">
        {summary.map((s) => (
          <div key={s.status} className={`intg-summary-item intg-summary-${s.status}`}>
            <span className="intg-summary-n">{s.n}</span>
            <span className="small">{tr(STATUS_LABEL[s.status])}</span>
          </div>
        ))}
      </div>
      <div className="form-card stack">
        <h2>{tr('Needs attention')}</h2>
        {attention.length === 0 && !aiNoticeNeeded ? <p className="muted small">{tr('Nothing needs attention.')}</p> : (
          <ul className="intg-attention">
            {aiNoticeNeeded ? (
              <li>
                <span>{tr('AI is on, but the owner has not accepted the current AI notice.')}</span>
                <Button size="sm" variant="outline" onClick={() => onOpen(AI_NOTICE_KEY)}>{tr('Open')}</Button>
              </li>
            ) : null}
            {attention.map(({ connection, status }) => (
              <li key={connection.key}>
                <IntegrationLogo kind={connection.key} name={connection.name} size="sm" />
                <span>{trf(status === 'problem' ? '{name}: the last call failed' : '{name} is still in test mode', { name: connection.name })}</span>
                <Button size="sm" variant="outline" onClick={() => onOpen(connection.key)}>{tr('Open')}</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="muted small">{tr('Each starts simulated, and nothing reaches a provider until you save the details and go live. Secret keys are saved once and cannot be shown again.')}</p>
    </div>
  );
}

const OVERVIEW_KEY = 'overview';
const AI_NOTICE_KEY = 'ai-notice';
const RATES_KEY = 'exchange-rates';

export function IntegrationsSettings() {
  const session = useSession();
  const canManage = hasPermission(session.permissions, 'core.integrations.manage');
  const channels = useLoad(() => api<IntegrationSettings[]>('/v1/core/integrations'));
  const providers = useLoad(() => api<ProviderSettings[]>('/v1/core/integrations/providers'));
  const ai = useLoad(() => api<AiStatus>('/v1/core/integrations/ai'));
  // The open item lives in the address (#paymob), so a link can open it and a reload keeps it.
  const [selected, setSelected] = useState(() => window.location.hash.slice(1) || OVERVIEW_KEY);
  // A plain link such as "Open the AI notice" (#ai-notice) also opens its item.
  useEffect(() => {
    const follow = () => setSelected(window.location.hash.slice(1) || OVERVIEW_KEY);
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  const open = (key: string) => {
    setSelected(key);
    window.history.replaceState(null, '', key === OVERVIEW_KEY ? window.location.pathname : `#${key}`);
  };

  if (!channels.data || !providers.data || !ai.data) {
    return <section className="page"><Loading error={channels.error ?? providers.error ?? ai.error} /></section>;
  }
  const status = ai.data;
  const reload = () => {
    channels.reload();
    providers.reload();
    ai.reload();
  };
  const consented = Boolean(status.consent && status.consent.version === AI_NOTICE_VERSION);

  const channelConnections: Connection[] = channels.data.map((c) => ({ key: c.kind, name: tr(NAME[c.kind]), enabled: c.enabled, mode: c.mode, lastStatus: c.lastStatus }));
  const providerConnections: Connection[] = PROVIDERS.flatMap((def) => {
    const p = providers.data?.find((x) => x.kind === def.kind);
    return p ? [{ key: def.kind, name: tr(def.name), enabled: p.enabled, mode: p.mode, lastStatus: p.lastStatus }] : [];
  });
  const connections = [...providerConnections, ...channelConnections];
  const byKey = new Map(connections.map((c) => [c.key, c]));
  const entries = (group: ProviderDef['group']) => PROVIDERS.filter((d) => d.group === group).flatMap((d) => (byKey.has(d.kind) ? [d.kind as string] : []));
  const aiOn = ['openai', 'elevenlabs', 'ollama'].some((k) => byKey.get(k)?.enabled);

  const menu: { title: string; keys: string[] }[] = [
    { title: 'Payments', keys: entries('payments') },
    { title: 'Shipping', keys: entries('shipping') },
    { title: 'Online store', keys: entries('store') },
    { title: 'Messages', keys: channelConnections.map((c) => c.key) },
    { title: 'AI and voice', keys: [AI_NOTICE_KEY, ...entries('ai')] },
    { title: 'Other', keys: [RATES_KEY] },
  ];
  const known = new Set([OVERVIEW_KEY, AI_NOTICE_KEY, RATES_KEY, ...connections.map((c) => c.key)]);
  const current = known.has(selected) ? selected : OVERVIEW_KEY;
  const label = (key: string) => (key === AI_NOTICE_KEY ? tr('AI notice') : key === RATES_KEY ? tr('Exchange rates') : (byKey.get(key)?.name ?? key));

  const providerDef = PROVIDERS.find((d) => d.kind === current);
  const providerItem = providers.data.find((p) => p.kind === current);
  const channelItem = channels.data.find((c) => c.kind === current);

  return (
    <section className="page">
      <h1>{tr('Integrations')}</h1>
      <p className="muted">{tr('Connect outside services here. You then use them inside your apps, such as Sales and Messages. Each starts in test mode, so nothing is really sent until you go live.')}</p>
      <div className={`intg ${current === OVERVIEW_KEY ? '' : 'intg-open'}`}>
        <nav className="intg-menu" aria-label={tr('Integrations')}>
          <button type="button" className={`intg-menu-item ${current === OVERVIEW_KEY ? 'is-current' : ''}`} aria-current={current === OVERVIEW_KEY ? 'page' : undefined} onClick={() => open(OVERVIEW_KEY)}>
            <span className="intg-menu-name">{tr('Overview')}</span>
          </button>
          {menu.map((group) => (
            <div key={group.title} className="intg-menu-group">
              <h2 className="intg-menu-title">{tr(group.title)}</h2>
              {group.keys.map((key) => {
                const c = byKey.get(key);
                return (
                  <button key={key} type="button" className={`intg-menu-item ${current === key ? 'is-current' : ''}`} aria-current={current === key ? 'page' : undefined} onClick={() => open(key)}>
                    {c ? <IntegrationLogo kind={key} name={c.name} size="sm" /> : null}
                    <span className="intg-menu-name">{label(key)}</span>
                    {c ? <StatusBadge status={connectionStatus(c)} /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="intg-pane">
          {current === OVERVIEW_KEY ? null : (
            <Button variant="ghost" size="sm" className="intg-back" onClick={() => open(OVERVIEW_KEY)}>{tr('Back to the list')}</Button>
          )}
          {current === OVERVIEW_KEY ? <Overview connections={connections} aiNoticeNeeded={aiOn && !consented} onOpen={open} /> : null}
          {channelItem ? <IntegrationCard key={channelItem.kind} item={channelItem} canManage={canManage} onChanged={reload} /> : null}
          {providerDef && providerItem ? <ProviderCard key={providerDef.kind} def={providerDef} item={providerItem} canManage={canManage} consented={consented} onChanged={reload} /> : null}
          {current === AI_NOTICE_KEY ? (
            <div className="stack intg-detail">
              <AiNotice status={status} canManage={canManage} onChanged={reload} />
              {consented && aiOn ? <AiTry canManage={canManage} /> : null}
            </div>
          ) : null}
          {current === RATES_KEY ? <ExchangeRates /> : null}
        </div>
      </div>
    </section>
  );
}
