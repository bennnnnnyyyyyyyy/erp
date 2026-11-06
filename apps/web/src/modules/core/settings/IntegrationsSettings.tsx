import { useState } from 'react';
import { hasPermission, INTEGRATION_MESSAGE_KINDS, type FxRate, type IntegrationKind, type IntegrationSettings } from '@erp/shared';
import { ChannelLogo } from '../../../components/icons';
import { ConfirmButton } from '../../../components/FormToggle';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { formatDateTime, formatDay } from '../../../lib/format';
import { tr, trf } from '../../../lib/i18n';
import { useLoad } from '../../../lib/useLoad';
import { demoMode } from '../../../lib/demo';
import { useSession } from '../../../session';
import { Notice, useNotice } from '../../accounting/common';
import { ProvidersSettings } from './ProvidersSettings';

// Settings > Integrations (INTEGRATIONS_PLAN.md wave 1; sql/053). Owners and admins. Each integration starts "simulated": messages
// are marked delivered but nothing leaves the system, so a company can try it safely. Webhook URLs are write-only (a hint is shown).
// A channel only delivers: approving still happens in the app.

const NAME: Record<IntegrationKind, string> = { email: 'Email', slack: 'Slack', teams: 'Microsoft Teams', telegram: 'Telegram' };
const HELP: Record<IntegrationKind, string> = {
  email: 'Sends a copy of the chosen messages to each person by email.',
  slack: 'Posts the chosen messages to one Slack channel. In Slack: create an app, turn on Incoming Webhooks, add it to a channel, and paste the webhook URL here.',
  teams: 'Posts the chosen messages to one Teams channel. In Teams: on the channel, open Workflows, choose "Send webhook alerts to a channel", and paste the URL it gives you here.',
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
    <div className={`form-card stack integration-card${item.enabled ? ' is-on' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="channel-logo"><ChannelLogo kind={item.kind} /></span>
        <h2>{tr(NAME[item.kind])}</h2>
        <span className={`pill st-${item.enabled ? 'sent' : 'cancelled'}`}>{item.enabled ? tr('On') : tr('Off')}</span>
        <span className="muted small">{item.mode === 'live' ? tr('Live') : tr('Simulated: nothing is really sent')}</span>
      </div>
      <p className="muted small">{tr(HELP[item.kind])}</p>
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
            <Button variant="outline" disabled={busy} onClick={() => save({ mode: 'simulated' })}>{tr('Back to simulated')}</Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
            await api(`/v1/core/integrations/${item.kind}/test`, { method: 'POST' });
            return item.kind === 'email' ? tr('A test email is queued to you; it goes out within five minutes (Messages → Message outbox).') : tr('A test message is queued; it goes out within five minutes (Messages → Message outbox).');
          }, onChanged)}>{tr('Send a test')}</Button>
        </div>
      ) : null}
      {!item.liveAvailable && item.mode === 'simulated' ? (
        <p className="muted small">{item.kind === 'email' ? tr('Live email is not set up on this server yet.') : tr('Save a webhook URL to go live.')}</p>
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

export function IntegrationsSettings() {
  const session = useSession();
  const canManage = hasPermission(session.permissions, 'core.integrations.manage');
  const list = useLoad(() => api<IntegrationSettings[]>('/v1/core/integrations'));
  const rates = useLoad(() => api<FxRate[]>('/v1/core/fx/today'));
  if (!list.data) return <section className="page"><Loading error={list.error} /></section>;
  return (
    <section className="page">
      <h1>{tr('Integrations')}</h1>
      <p className="muted">{tr('Send copies of your messages to email, Slack or Microsoft Teams. Each starts simulated, so you can try it without anything being sent. A message never approves anything by itself: decisions are made in the app.')}</p>
      {list.data.map((item) => <IntegrationCard key={item.kind} item={item} canManage={canManage} onChanged={list.reload} />)}

      {demoMode ? null : <ProvidersSettings />}

      <div className="form-card stack">
        <h2>{tr('Exchange rates')}</h2>
        <p className="muted small">{tr('Daily mid-market rates from central banks (Frankfurter), saved once a day. For tax and accounting, confirm with your accountant which official rate applies.')}</p>
        {!rates.data ? <Loading error={rates.error} rows={2} /> : rates.data.length ? (
          <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Currency')}</th><th scope="col" className="right">{trf('In {currency}', { currency: session.org?.defaultCurrency ?? '' })}</th><th scope="col">{tr('Date')}</th></tr></thead><tbody>
            {rates.data.map((r) => <tr key={r.from}><td>{r.from}</td><td className="right">{r.rate.toFixed(4)}</td><td>{formatDay(r.rateDate, session.org)}</td></tr>)}
          </tbody></table></div>
        ) : <p className="muted small">{tr('No rates saved yet; they arrive with the next scheduled run.')}</p>}
      </div>
    </section>
  );
}
