import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { tr, trf } from '../../../lib/i18n';
import { Notice, useNotice } from '../../accounting/common';

// Try the assistant and voice transcription (sql/056, sql/060). The answer is only text for a person to read: nothing is changed
// by it, and it only sees what the person asking is allowed to see.

type Answer = { answer?: string; text?: string; provider: string | null; simulated?: boolean; used?: number };

export function AiTry({ canManage }: { canManage: boolean }) {
  const { message, busy, run } = useNotice();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const show = (a: Answer) => setResult(`${a.answer ?? a.text ?? ''}${a.provider ? `\n\n— ${a.provider}${a.simulated ? ` (${tr('simulated')})` : ''}${a.used ? ` · ${trf('{n} items looked at', { n: a.used })}` : ''}` : ''}`);

  return (
    <div className="form-card stack">
      <h3>{tr('Try it')}</h3>
      <p className="muted small">{tr('Ask about your stock in plain words, for example "how many cooking oil do we have?". The assistant only answers; it cannot change anything.')}</p>
      <Notice message={message} />
      <label>
        {tr('Your question')}
        <input value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} />
      </label>
      <div className="form-row">
        <Button
          disabled={busy || question.trim().length < 3}
          onClick={() =>
            run(async () => {
              show(await api<Answer>('/v1/core/ai/assistant', { method: 'POST', body: JSON.stringify({ question }) }));
              return tr('Answered.');
            })
          }
        >
          {tr('Ask')}
        </Button>
        {canManage ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                show(await api<Answer>('/v1/core/ai/test', { method: 'POST' }));
                return tr('The AI provider answered.');
              })
            }
          >
            {tr('Test the AI connection')}
          </Button>
        ) : null}
        <label className="small">
          {tr('Transcribe a recording')}
          <input
            type="file"
            accept="audio/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.append('audio', file);
              void run(async () => {
                show(await api<Answer>('/v1/core/ai/transcribe', { method: 'POST', body: form }));
                return tr('Transcribed.');
              });
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {result ? <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{result}</pre> : null}
    </div>
  );
}
