import { useEffect, useRef, useState } from 'react';
import { hasPermission } from '@erp/shared';
import { ApiError, api } from '../lib/api';
import { demoMode } from '../lib/demo';
import { tr, trf } from '../lib/i18n';
import { useParam } from '../lib/router';
import { useSession } from '../session';
import { DocQr } from '../modules/sales/print/DocQr';
import { BarcodeScanner } from './BarcodeScanner';
import { Button } from './ui/button';

// The phone as a barcode scanner for the computer (sql/115; Ben's answers 25 Nov 2026: polling every 1.5 s, sales and purchase orders,
// the same person only). The computer shows a QR; the phone, signed in as the same person in the same company, opens it and scans;
// each barcode reaches the open form, which adds the item as its own "Scan a barcode" does. A scan never saves anything.

export type ScanForm = 'sales_order' | 'purchase_order';
type Session = { sessionId: string; code: string; form: ScanForm; expiresAt: string };
type Poll = { open: boolean; expiresAt: string; scans: { id: number; barcode: string }[] };

const POLL_MS = 1500;
const appOf = (form: ScanForm) => (form === 'sales_order' ? 'sales' : 'purchasing');

/** "Scan with my phone" on the computer's order form. `onCode` gets each barcode the phone sends. */
export function PhoneScanButton({ form, onCode }: { form: ScanForm; onCode: (code: string) => void }) {
  const session = useSession();
  const [s, setS] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  // Poll while a session is open; stop it when the form closes.
  useEffect(() => {
    if (!s) return;
    let last = 0;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const p = await api<Poll>(`/v1/core/scan-sessions/${s.sessionId}/scans?after=${last}`);
        if (stopped) return;
        for (const scan of p.scans) {
          last = Math.max(last, scan.id);
          setCount((n) => n + 1);
          onCodeRef.current(scan.barcode);
        }
        if (!p.open) {
          setS(null);
          setError(tr('The phone scanner stopped. Start it again to go on scanning.'));
        }
      } catch {
        // a lost request: the next one tries again
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      void api(`/v1/core/scan-sessions/${s.sessionId}/end`, { method: 'POST' }).catch(() => undefined);
    };
  }, [s]);

  if (demoMode || !hasPermission(session.permissions, 'core.scanner.use')) return null;

  async function start() {
    setError(null);
    setCount(0);
    try {
      setS(await api<Session>('/v1/core/scan-sessions', { method: 'POST', body: JSON.stringify({ form }) }));
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'not_set_up' ? tr('The phone scanner needs a database update first.') : (e as Error).message);
    }
  }

  const link = s ? `${window.location.origin}/${appOf(form)}/scan/${s.code}` : '';
  return (
    <>
      {s ? (
        <Button variant="outline" type="button" onClick={() => setS(null)}>
          {tr('Stop the phone scanner')}
        </Button>
      ) : (
        <Button variant="outline" type="button" onClick={() => void start()}>
          {tr('Scan with my phone')}
        </Button>
      )}
      {s ? (
        <div className="phone-scan-panel" role="status">
          <DocQr text={link} label={tr('Scan this with your phone')} />
          <p className="small">
            {tr('Scan this with your phone’s camera. Sign in on the phone as yourself, in this company. Each barcode you scan there is added here.')}
          </p>
          <p className="muted small">
            {trf('{n} scanned so far. The link stops 10 minutes after the last scan.', { n: count })}
          </p>
        </div>
      ) : null}
      {error ? <p className="error small">{error}</p> : null}
    </>
  );
}

/** The phone page: /sales/scan/:code and /purchasing/scan/:code. */
export function PhoneScanPage() {
  const code = useParam('code') ?? '';
  const [state, setState] = useState<'joining' | 'ready' | 'gone'>('joining');
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [paused, setPaused] = useState(false);
  // the person closed the camera: a button opens it again
  const [closed, setClosed] = useState(false);
  const lastRef = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    api('/v1/core/scan-sessions/join', { method: 'POST', body: JSON.stringify({ code }) })
      .then(() => setState('ready'))
      .catch(() => setState('gone'));
  }, [code]);

  async function send(barcode: string) {
    const now = Date.now();
    const last = lastRef.current;
    // the same barcode still in front of the camera: once only
    if (last && last.code === barcode && now - last.at < 2500) return restartSoon();
    lastRef.current = { code: barcode, at: now };
    setError(null);
    try {
      await api('/v1/core/scan-sessions/scans', { method: 'POST', body: JSON.stringify({ code, barcode }) });
      setSent((xs) => [barcode, ...xs].slice(0, 20));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState('gone');
      else setError((e as Error).message);
    }
    restartSoon();
  }
  function restartSoon() {
    setPaused(true);
    setTimeout(() => {
      setPaused(false);
      setRound((n) => n + 1);
    }, 1200);
  }

  return (
    <section className="page">
      <h1>{tr('Phone scanner')}</h1>
      {state === 'joining' ? <p className="muted">{tr('Connecting…')}</p> : null}
      {state === 'gone' ? (
        <p className="error">
          {tr('This scanner link has ended or is not for you. On the computer, press “Scan with my phone” again and scan the new code.')}
        </p>
      ) : null}
      {state === 'ready' ? (
        <>
          <p className="muted small">{tr('Point the camera at a barcode. Each one goes to the order open on your computer.')}</p>
          {closed ? (
            <Button
              type="button"
              onClick={() => {
                setClosed(false);
                setRound((n) => n + 1);
              }}
            >
              {tr('Scan again')}
            </Button>
          ) : paused ? null : (
            <BarcodeScanner key={round} title={tr('Scan a barcode')} onCode={(c) => void send(c)} onClose={() => setClosed(true)} />
          )}
          {error ? <p className="error small">{error}</p> : null}
          {sent.length ? (
            <>
              <h2 className="related">{tr('Sent')}</h2>
              <ul>
                {sent.map((b, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the same barcode may be sent more than once
                  <li key={`${b}-${i}`}>
                    <bdi>{b}</bdi>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
