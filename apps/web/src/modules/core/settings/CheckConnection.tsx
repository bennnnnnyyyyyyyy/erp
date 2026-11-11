import { useState } from 'react';
import type { IntegrationCheck } from '@erp/shared';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { tr } from '../../../lib/i18n';

// "Check connection" (sql/082): one real, harmless call to the provider with the saved details, answered at once. There is no test
// mode any more, so this is how an owner sees that an integration really works. The provider's own words are shown as they came
// (they are not translated); the result is also saved as the integration's last call.

export function CheckConnection({ kind, disabled, onChecked }: { kind: string; disabled?: boolean; onChecked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IntegrationCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api<IntegrationCheck>(`/v1/core/integrations/check/${kind}`, { method: 'POST' }));
      onChecked();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('The check could not run.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="form-row">
        <Button variant="outline" disabled={busy || disabled} onClick={check}>
          {busy ? tr('Checking…') : tr('Check connection')}
        </Button>
      </div>
      {result ? (
        <p className={result.ok ? 'small' : 'error small'} role="status">
          <strong>{result.ok ? tr('Working') : tr('Not working')}</strong>
          {' · '}
          <span dir="auto">{result.message}</span>
          {result.url ? (
            <>
              {' '}
              <a href={result.url} target="_blank" rel="noreferrer noopener">
                {tr('Open the test payment page')}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {error ? <p className="error small" role="alert">{error}</p> : null}
    </div>
  );
}
