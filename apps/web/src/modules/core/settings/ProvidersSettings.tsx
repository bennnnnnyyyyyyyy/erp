import { useState } from 'react';
import { AI_NOTICE_VERSION, type AiStatus, type ProviderDef, type ProviderSettings } from '@erp/shared';
import { ConfirmButton } from '../../../components/FormToggle';
import { Button } from '../../../components/ui/button';
import { API_BASE_URL, api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { tr, trf } from '../../../lib/i18n';
import { useSession } from '../../../session';
import { Notice, useNotice } from '../../accounting/common';
import { CheckConnection } from './CheckConnection';
import { IntegrationHeader } from './IntegrationHeader';
import { connectionStatus } from './integrationStatus';

// Settings > Integrations: one payment, shipping, store or AI provider (sql/056). Secret fields are write-only: once saved they show as
// "saved" and can only be replaced or removed. AI needs the owner's consent first. sql/082: there is no test mode; switching on means
// the real provider, and needs the required details saved. "Check connection" makes one real, harmless call.

// Every AI provider needs the current AI notice, Ollama included (sql/061; repo audit N10).
const AI_KINDS = new Set(['openai', 'elevenlabs', 'ollama']);

export function ProviderCard({ def, item, canManage, consented, onChanged }: { def: ProviderDef; item: ProviderSettings; canManage: boolean; consented: boolean; onChanged: () => void }) {
  const session = useSession();
  const { message, busy, run } = useNotice();
  const [values, setValues] = useState<Record<string, string>>({});
  const needsConsent = AI_KINDS.has(def.kind) && !consented;
  const missing = def.fields.filter((f) => f.required && !item.savedFields.includes(f.key) && !values[f.key]);
  const setEnabled = (enabled: boolean) =>
    run(async () => {
      await api(`/v1/core/integrations/providers/${def.kind}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
      return enabled ? tr('Switched on. It now uses the real provider.') : tr('Switched off.');
    }, onChanged);
  const dirty = Object.values(values).some((v) => v !== '');

  return (
    <div className="form-card stack intg-detail">
      <IntegrationHeader kind={def.kind} name={tr(def.name)} summary={tr(def.summary)} status={connectionStatus(item)} />
      <Notice message={message} />
      <fieldset className="stack" disabled={!canManage || busy}>
        {def.fields.map((f) => {
          const saved = item.savedFields.includes(f.key);
          return (
            <label key={f.key}>
              {tr(f.label)}
              {f.required ? ' *' : ''}
              <input
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={f.secret && saved ? tr('Saved. Type to replace.') : f.placeholder}
                value={values[f.key] ?? (f.secret ? '' : (item.config[f.key] ?? ''))}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
              {f.help ? <span className="muted small">{tr(f.help)}</span> : null}
            </label>
          );
        })}
      </fieldset>
      {canManage ? (
        <div className="form-row">
          <Button
            variant="outline"
            disabled={busy || !dirty}
            onClick={() =>
              run(async () => {
                await api(`/v1/core/integrations/providers/${def.kind}/fields`, { method: 'PUT', body: JSON.stringify({ values }) });
                setValues({});
                return tr('Saved. Secret values cannot be shown again.');
              }, onChanged)
            }
          >
            {tr('Save details')}
          </Button>
          {item.enabled ? (
            <Button variant="outline" disabled={busy} onClick={() => setEnabled(false)}>
              {tr('Switch off')}
            </Button>
          ) : (
            <ConfirmButton
              label={tr('Switch on')}
              confirmLabel={tr('Yes, switch on')}
              question={tr('Switch on? From now on this really contacts the provider. There is no test mode: use the provider\'s own test keys to try it first.')}
              disabled={busy || needsConsent || missing.length > 0 || dirty}
              onConfirm={() => setEnabled(true)}
            />
          )}
        </div>
      ) : null}
      {canManage && item.savedFields.length > 0 ? <CheckConnection kind={def.kind} disabled={busy || dirty} onChecked={onChanged} /> : null}
      {/* UX audit: this told the owner, in the third person, to accept a notice "below" that is a separate item in the list. */}
      {needsConsent ? (
        <p className="muted small">
          {session.role === 'owner' ? tr('Accept the AI notice first.') : tr('The company owner must accept the AI notice first.')}{' '}
          <a href="#ai-notice">{tr('Open the AI notice')}</a>
        </p>
      ) : null}
      {missing.length ? <p className="muted small">{trf('To switch it on, fill in: {fields}', { fields: missing.map((f) => tr(f.label)).join(', ') })}</p> : null}
      {def.webhookPath ? <p className="muted small">{trf('Address to give {name} for its notifications: {url}', { name: tr(def.name), url: item.callbackUrl ?? `${API_BASE_URL}${def.webhookPath}` })}</p> : null}
      {item.lastStatus ? (
        <p className={item.lastStatus === 'failed' ? 'error small' : 'muted small'}>
          {item.lastStatus === 'sent' ? tr('Last call worked') : tr('Last call failed')}
          {item.lastDeliveryAt ? ` · ${formatDateTime(item.lastDeliveryAt, session.org)}` : ''}
          {item.lastError ? ` · ${item.lastError}` : ''}
        </p>
      ) : null}
    </div>
  );
}

export function AiNotice({ status, canManage, onChanged }: { status: AiStatus; canManage: boolean; onChanged: () => void }) {
  const session = useSession();
  const { message, busy, run } = useNotice();
  const isOwner = session.role === 'owner';
  const consent = (accept: boolean) =>
    run(async () => {
      await api('/v1/core/integrations/ai/consent', { method: 'PUT', body: JSON.stringify({ accept }) });
      return accept ? tr('AI notice accepted.') : tr('Consent withdrawn. AI providers are switched off.');
    }, onChanged);
  const current = Boolean(status.consent && status.consent.version === AI_NOTICE_VERSION);
  return (
    <div className="form-card stack">
      <h3>{tr('AI notice')}</h3>
      <p className="small">
        {tr(
          'When AI is on, the text you ask about, the related company records, or voice recordings are sent to the AI provider to produce an answer: OpenAI or ElevenLabs, or, with Ollama, the server at the address you enter, which our servers reach over the internet. The assistant only suggests: it never changes data by itself and only sees what the person asking is allowed to see.',
        )}
      </p>
      <p className="muted small">
        {trf('This month your company made {calls} AI calls. Without your own key, AI use is included up to a monthly limit.', { calls: status.monthCalls })}
      </p>
      <Notice message={message} />
      {status.consent ? (
        <p className="small">{trf('Accepted {when} (notice {version}).', { when: formatDateTime(status.consent.acceptedAt, session.org), version: status.consent.version })}</p>
      ) : (
        <p className="small">{tr('Not accepted yet. AI providers stay off until the owner accepts.')}</p>
      )}
      {status.consent && !current ? <p className="small">{tr('The AI notice has changed. AI stays off until the owner accepts the new version.')}</p> : null}
      {canManage && isOwner ? (
        current ? (
          <ConfirmButton label={tr('Withdraw consent')} confirmLabel={tr('Yes, withdraw')} question={tr('Withdraw consent? All AI providers switch off.')} disabled={busy} onConfirm={() => consent(false)} />
        ) : (
          <Button disabled={busy} onClick={() => consent(true)}>
            {tr('I accept: allow sending company data to the AI provider')}
          </Button>
        )
      ) : (
        <p className="muted small">{tr('Only the owner can accept or withdraw.')}</p>
      )}
    </div>
  );
}

