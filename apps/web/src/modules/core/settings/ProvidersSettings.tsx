import { useState } from 'react';
import { AI_NOTICE_VERSION, hasPermission, PROVIDERS, type AiStatus, type ProviderDef, type ProviderSettings } from '@erp/shared';
import { ConfirmButton } from '../../../components/FormToggle';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { tr, trf } from '../../../lib/i18n';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';
import { Notice, useNotice } from '../../accounting/common';

// Settings > Integrations: payments, shipping, store and AI providers (sql/056). Secret fields are write-only: once saved they show as
// "saved" and can only be replaced or removed. Every provider starts simulated. AI needs the owner's consent first.

const GROUP_TITLE: Record<ProviderDef['group'], string> = { payments: 'Payments', shipping: 'Shipping', store: 'Online store', ai: 'AI and voice' };
const AI_KINDS = new Set(['openai', 'elevenlabs']);

function ProviderCard({ def, item, canManage, consented, onChanged }: { def: ProviderDef; item: ProviderSettings; canManage: boolean; consented: boolean; onChanged: () => void }) {
  const session = useSession();
  const { message, busy, run } = useNotice();
  const [values, setValues] = useState<Record<string, string>>({});
  const needsConsent = AI_KINDS.has(def.kind) && !consented;
  const missing = def.fields.filter((f) => f.required && !item.savedFields.includes(f.key) && !values[f.key]);
  const setMode = (patch: { enabled?: boolean; mode?: 'simulated' | 'live' }) =>
    run(async () => {
      await api(`/v1/core/integrations/providers/${def.kind}`, { method: 'PUT', body: JSON.stringify({ enabled: item.enabled, mode: item.mode, ...patch }) });
      return tr('Saved.');
    }, onChanged);
  const dirty = Object.values(values).some((v) => v !== '');

  return (
    <div className="form-card stack">
      <div className="flex flex-wrap items-center gap-2">
        <h3>{tr(def.name)}</h3>
        <span className={`pill st-${item.enabled ? 'sent' : 'cancelled'}`}>{item.enabled ? tr('On') : tr('Off')}</span>
        <span className="muted small">{item.mode === 'live' ? tr('Live') : tr('Simulated: nothing is really sent')}</span>
      </div>
      <p className="muted small">{tr(def.summary)}</p>
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
          <Button variant={item.enabled ? 'outline' : 'default'} disabled={busy || needsConsent} onClick={() => setMode({ enabled: !item.enabled })}>
            {item.enabled ? tr('Switch off') : tr('Switch on')}
          </Button>
          {item.mode === 'simulated' ? (
            <ConfirmButton
              label={tr('Go live')}
              confirmLabel={tr('Yes, go live')}
              question={tr('Go live? This will really contact the provider from now on.')}
              disabled={busy || needsConsent || missing.length > 0 || dirty}
              onConfirm={() => setMode({ mode: 'live' })}
            />
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => setMode({ mode: 'simulated' })}>
              {tr('Back to simulated')}
            </Button>
          )}
        </div>
      ) : null}
      {needsConsent ? <p className="muted small">{tr('The owner must accept the AI notice below first.')}</p> : null}
      {missing.length ? <p className="muted small">{trf('To go live, fill in: {fields}', { fields: missing.map((f) => tr(f.label)).join(', ') })}</p> : null}
      {def.webhookPath ? <p className="muted small">{trf('Provider callback path: {path} (on your API address).', { path: def.webhookPath })}</p> : null}
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

function AiNotice({ status, canManage, onChanged }: { status: AiStatus; canManage: boolean; onChanged: () => void }) {
  const session = useSession();
  const { message, busy, run } = useNotice();
  const isOwner = session.role === 'owner';
  const consent = (accept: boolean) =>
    run(async () => {
      await api('/v1/core/integrations/ai/consent', { method: 'PUT', body: JSON.stringify({ accept }) });
      return accept ? tr('AI notice accepted.') : tr('Consent withdrawn. OpenAI and ElevenLabs are switched off.');
    }, onChanged);
  const current = Boolean(status.consent && status.consent.version === AI_NOTICE_VERSION);
  return (
    <div className="form-card stack">
      <h3>{tr('AI notice')}</h3>
      <p className="small">
        {tr(
          'When AI is on, the text you ask about, the related company records, or voice recordings are sent to the AI provider (OpenAI or ElevenLabs) to produce an answer. The assistant only suggests: it never changes data by itself and only sees what the person asking is allowed to see. Prefer to keep everything in-house? Use Ollama below: it runs on your own computer or server, and nothing leaves your company.',
        )}
      </p>
      <p className="muted small">
        {trf('Shared AI service: limited to USD {cap} a month across all companies. This month your company made {calls} AI calls. A company that adds its own key is not limited by this.', {
          cap: status.serviceCapUsd,
          calls: status.monthCalls,
        })}
      </p>
      <Notice message={message} />
      {status.consent ? (
        <p className="small">{trf('Accepted {when} (notice {version}).', { when: formatDateTime(status.consent.acceptedAt, session.org), version: status.consent.version })}</p>
      ) : (
        <p className="small">{tr('Not accepted yet. OpenAI and ElevenLabs stay off until the owner accepts.')}</p>
      )}
      {canManage && isOwner ? (
        current ? (
          <ConfirmButton label={tr('Withdraw consent')} confirmLabel={tr('Yes, withdraw')} question={tr('Withdraw consent? OpenAI and ElevenLabs switch off.')} disabled={busy} onConfirm={() => consent(false)} />
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

export function ProvidersSettings() {
  const session = useSession();
  const canManage = hasPermission(session.permissions, 'core.integrations.manage');
  const list = useLoad(() => api<ProviderSettings[]>('/v1/core/integrations/providers'));
  const ai = useLoad(() => api<AiStatus>('/v1/core/integrations/ai'));
  const providers = list.data;
  const status = ai.data;
  if (!providers || !status) return <Loading error={list.error ?? ai.error} rows={3} />;
  const reload = () => {
    list.reload();
    ai.reload();
  };
  const consented = Boolean(status.consent && status.consent.version === AI_NOTICE_VERSION);
  const groups = ['payments', 'shipping', 'store', 'ai'] as const;
  return (
    <>
      <h2>{tr('Payments, shipping, store and AI')}</h2>
      <p className="muted small">{tr('Each starts simulated, and nothing reaches a provider until you save the details and go live. Secret keys are saved once and cannot be shown again.')}</p>
      {groups.map((g) => (
        <div key={g} className="stack">
          <h3>{tr(GROUP_TITLE[g])}</h3>
          {g === 'ai' ? <AiNotice status={status} canManage={canManage} onChanged={reload} /> : null}
          {PROVIDERS.filter((p) => p.group === g).map((def) => {
            const item = providers.find((x) => x.kind === def.kind);
            return item ? <ProviderCard key={def.kind} def={def} item={item} canManage={canManage} consented={consented} onChanged={reload} /> : null;
          })}
        </div>
      ))}
    </>
  );
}
