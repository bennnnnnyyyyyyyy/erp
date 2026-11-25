import { useEffect, useRef, useState } from 'react';
import type { DocPrintData } from '@erp/shared';
import { Button } from '../../../components/ui/button';
import { API_BASE_URL } from '../../../lib/api';
import { tr } from '../../../lib/i18n';
import { PrintDocument } from './PrintDocument';
import { docFileBase, pdfFileName } from './docFileName';
import { saveBlob, sheetToPdf } from './pdf';

// The page a customer opens from a WhatsApp or email link (/i/<token>). No sign-in, no menu: only the document, Print and Download PDF.
// The token is the only key; the API answers a bare 404 for a missing, switched-off or voided link and we say only "not available".

export function PublicInvoicePage({ token }: { token: string }) {
  const [data, setData] = useState<DocPrintData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The link must not leak in the Referer of anything the page loads.
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    if (!/^[0-9a-f]{64}$/.test(token)) {
      setState('gone');
      return;
    }
    fetch(`${API_BASE_URL}/i/${token}`, { referrerPolicy: 'no-referrer' })
      .then(async (res) => {
        if (res.status === 404) return setState('gone');
        const body = (await res.json().catch(() => null)) as { success?: boolean; data?: DocPrintData } | null;
        if (!res.ok || !body?.success || !body.data) return setState('error');
        setData(body.data);
        setState('ready');
        document.title = docFileBase(body.data.document, body.data.customer?.name, body.data.settings.language);
      })
      .catch(() => setState('error'));
  }, [token]);

  async function pdf() {
    const el = ref.current?.querySelector<HTMLElement>('.print-sheet');
    if (!el || !data) return;
    setBusy(true);
    try {
      saveBlob(await sheetToPdf(el), pdfFileName(data.document, data.customer?.name, data.settings.language));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <main className="center"><p className="muted">{tr('Loading…')}</p></main>;
  if (state === 'gone') return <main className="center"><p>{tr('This document is not available. The link may have been switched off. Ask the sender for a new one.')}</p></main>;
  if (state === 'error' || !data) return <main className="center"><p>{tr('Cannot reach the server. Check your internet connection and try again.')}</p></main>;

  return (
    <main className="public-invoice">
      <div className="print-toolbar print-noprint">
        <Button onClick={() => window.print()}>{tr('Print')}</Button>
        <Button variant="outline" disabled={busy} onClick={pdf}>{busy ? tr('Making the PDF…') : tr('Download PDF')}</Button>
      </div>
      <div className="print-root" ref={ref}>
        <div className="print-stage">
          <PrintDocument data={data} options={{ layout: data.settings.layout, language: data.settings.language }} />
        </div>
      </div>
    </main>
  );
}
