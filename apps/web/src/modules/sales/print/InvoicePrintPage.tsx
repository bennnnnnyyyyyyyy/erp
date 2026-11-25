import { useEffect, useRef, useState } from 'react';
import {
  DOC_LANGUAGES,
  DOC_LAYOUTS,
  hasPermission,
  type DocLanguage,
  type DocLayout,
  type DocPrintData,
  type DocQueueSend,
  type DocQueueStatus,
  type PrintDocType,
  type SendDocType,
} from '@erp/shared';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { tr, trf } from '../../../lib/i18n';
import { BackLink as HistoryBackLink, Link, useParam } from '../../../lib/router';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';
import { PrintDocument } from './PrintDocument';
import { docFileBase, pdfFileName } from './docFileName';
import { saveBlob, sheetToPdf } from './pdf';
import { emailSubject, looksLikeEmail, mailtoUrl, sendMessage, waPhone, whatsappUrl } from './sendText';

// Print, download and send one document (step 1c). Drafts print with the DRAFT mark and cannot be sent. An issued invoice or an approved
// note can be sent by WhatsApp or email from the person's own device, with a private link the customer opens without signing in; the link
// works until the invoice is voided or someone switches it off. Each print, download and send is recorded (core_doc_sends) and audited.
// When the company chose "send from the company" (sql/107), WhatsApp and email go into the message queue instead and are sent from the
// company's connected email or our WhatsApp invoice template; a channel that is not ready falls back to the device, and the page says so.

const LAYOUT_LABEL: Record<DocLayout, string> = { simple: 'Simple', detailed: 'Detailed (VAT on each line)', eta: 'ETA layout' };
const LANGUAGE_LABEL: Record<DocLanguage, string> = { ar: 'Arabic', en: 'English', both: 'Arabic and English' };

type LinkInfo = { token: string; createdAt: string; readCount: number; lastReadAt: string | null };
type LinkStatus = { active: boolean; createdAt?: string; readCount?: number; lastReadAt?: string | null };

const isPrintType = (t: string): t is PrintDocType => t === 'draft' || t === 'invoice' || t === 'note';

export function InvoicePrintPage() {
  const typeParam = useParam('type');
  const id = useParam('id');
  const type: PrintDocType = isPrintType(typeParam) ? typeParam : 'invoice';
  const session = useSession();
  const data = useLoad(() => api<DocPrintData>(`/v1/sales/print/${type}/${id}`));
  // Send mode, the customer's saved email and phone, and the sends from the company (sql/107). Missing before the migration: device only.
  const queue = useLoad(() => (type !== 'draft' ? api<DocQueueStatus>(`/v1/sales/documents/${type}/${id}/queue`).catch(() => null) : Promise.resolve(null)));
  const sendable = data.data ? isSendable(data.data) : false;
  const linkStatus = useLoad(() => (type !== 'draft' ? api<LinkStatus>(`/v1/sales/documents/${type}/${id}/link`).catch(() => null) : Promise.resolve(null)));
  const [layout, setLayout] = useState<DocLayout | null>(null);
  const [language, setLanguage] = useState<DocLanguage | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // The document's own name ("INV-2026-00001 - Nile Foods"): the page title, which the browser's "Save as PDF" offers, and the PDF file name.
  const fileBase = data.data ? docFileBase(data.data.document, data.data.customer?.name, language ?? data.data.settings.language) : null;
  useEffect(() => {
    if (!fileBase) return;
    const before = document.title;
    document.title = fileBase;
    return () => {
      document.title = before;
    };
  }, [fileBase]);

  if (data.error) return <section className="page"><BackLink type={type} id={id} invoiceId={null} /><Loading error={data.error} /></section>;
  if (!data.data) return <section className="page"><Loading /></section>;
  const d = data.data;
  const lay = layout ?? d.settings.layout;
  const lang = language ?? d.settings.language;
  const canSend = sendable && hasPermission(session.permissions, 'sales.invoices.send');
  const sendType = type as SendDocType;
  const companyName = d.company.legalName ?? d.company.name;
  const q = queue.data;
  const serverMode = q?.sendMode === 'queue';
  const emailByServer = serverMode && q?.emailConnected === true;
  const whatsappByServer = serverMode && q?.whatsappReady === true;
  // Typed by the person, else the customer's saved address (company send) or empty (device send, as before).
  const emailTo = email ?? (serverMode ? (q?.customerEmail ?? '') : '');
  const phoneTo = phone ?? q?.customerPhone ?? d.customer?.phone ?? '';

  async function record(channel: 'whatsapp' | 'email' | 'download' | 'print' | 'link', recipient?: string) {
    if (!sendable) return;
    try {
      await api(`/v1/sales/documents/${sendType}/${id}/sends`, { method: 'POST', body: JSON.stringify({ channel, mode: 'device', recipient: recipient ?? null, layout: lay, language: lang }) });
    } catch {
      // The record is for the history; a failed record never stops the person's print or send.
    }
  }

  async function linkUrl(fresh = false): Promise<string> {
    const l = await api<LinkInfo>(`/v1/sales/documents/${sendType}/${id}/link`, { method: 'POST', body: JSON.stringify({ new: fresh }) });
    linkStatus.reload();
    return `${window.location.origin}/i/${l.token}`;
  }

  async function run(what: string, job: () => Promise<string | null>) {
    setBusy(what); setMessage(null);
    try {
      const done = await job();
      if (done) setMessage({ ok: true, text: done });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const sheet = () => sheetRef.current?.querySelector<HTMLElement>('.print-sheet') ?? null;

  const doPrint = () => run('print', async () => {
    if (fileBase) document.title = fileBase;
    window.print();
    await record('print');
    return null;
  });
  const doPdf = () => run('pdf', async () => {
    const el = sheet();
    if (!el) throw new Error(tr('This layout cannot be printed yet: fill in what is missing first.'));
    saveBlob(await sheetToPdf(el), pdfFileName(d.document, d.customer?.name, lang));
    await record('download');
    return tr('PDF downloaded.');
  });
  const doWhatsApp = () => run('whatsapp', async () => {
    if (whatsappByServer) {
      const to = waPhone(phoneTo);
      if (!to) throw new Error(tr('Type the customer’s WhatsApp number first.'));
      return queueSend('whatsapp', to);
    }
    // Open the window first (browsers block a window opened after a wait), then point it at WhatsApp.
    const w = window.open('', '_blank');
    try {
      const url = await linkUrl();
      const to = waPhone(phoneTo);
      const target = whatsappUrl(to, sendMessage(d.document, companyName, url, lang));
      if (w) w.location.href = target; else window.location.href = target;
      await record('whatsapp', to ? `+${to}` : undefined);
      return to ? tr('WhatsApp opened with the message and the link. Press send there.') : tr('WhatsApp opened. The customer has no phone number: choose the chat there.');
    } catch (e) {
      w?.close();
      throw e;
    }
  });
  const doEmail = () => run('email', async () => {
    if (!looksLikeEmail(emailTo)) throw new Error(tr('Type the customer’s email address first.'));
    if (emailByServer) return queueSend('email', emailTo);
    const url = await linkUrl();
    window.location.href = mailtoUrl(emailTo, emailSubject(d.document, companyName, lang), sendMessage(d.document, companyName, url, lang));
    await record('email', emailTo.trim());
    return tr('Your email app opened with the message and the link. Press send there.');
  });
  // From the company (sql/107): the database checks and queues it; the delivery job sends it within about five minutes.
  async function queueSend(channel: 'email' | 'whatsapp', to: string): Promise<string> {
    const r = await api<{ duplicate: boolean }>(`/v1/sales/documents/${sendType}/${id}/queue`, {
      method: 'POST',
      body: JSON.stringify({ channel, to, layout: lay, language: lang }),
    });
    queue.reload();
    linkStatus.reload();
    if (r.duplicate) return tr('This was already sent a moment ago. It is not sent twice.');
    return channel === 'email'
      ? tr('Queued. The company email sends it within about five minutes. Its status is below.')
      : tr('Queued. WhatsApp sends it within about five minutes. Its status is below.');
  }
  const doCopy = () => run('copy', async () => {
    const url = await linkUrl();
    await navigator.clipboard.writeText(url);
    await record('link');
    return tr('Link copied. Anyone with it can see this document until it is voided or the link is switched off.');
  });
  const doNewLink = () => run('new', async () => {
    const url = await linkUrl(true);
    await navigator.clipboard.writeText(url).catch(() => undefined);
    return tr('A new link was made and copied. The old link no longer works.');
  });
  const doRevoke = () => run('revoke', async () => {
    await api(`/v1/sales/documents/${sendType}/${id}/link/revoke`, { method: 'POST' });
    linkStatus.reload();
    return tr('The link is switched off. The customer can no longer open it.');
  });

  return (
    <section className="page wide">
      <div className="print-noprint">
        <BackLink type={type} id={id} invoiceId={d.document.invoiceId ?? null} />
        <h1>{d.document.number ?? tr('Draft invoice')}</h1>
        {type === 'draft' ? <p className="muted">{tr('A draft can still change. It prints with a DRAFT mark and gets its number when it is issued.')}</p> : null}
        {type === 'note' && d.document.status !== 'approved' ? <p className="muted">{tr('This note is not approved yet. It prints with a DRAFT mark and cannot be sent.')}</p> : null}
        {message && <p className={message.ok ? 'notice' : 'error notice'} role="status">{message.text}</p>}
        <div className="print-toolbar">
          <label>{tr('Layout')}
            <select value={lay} onChange={(e) => setLayout(e.target.value as DocLayout)}>
              {DOC_LAYOUTS.map((l) => <option key={l} value={l}>{tr(LAYOUT_LABEL[l])}</option>)}
            </select>
          </label>
          <label>{tr('Language of the document')}
            <select value={lang} onChange={(e) => setLanguage(e.target.value as DocLanguage)}>
              {DOC_LANGUAGES.map((l) => <option key={l} value={l}>{tr(LANGUAGE_LABEL[l])}</option>)}
            </select>
          </label>
          <Button disabled={!!busy} onClick={doPrint}>{tr('Print')}</Button>
          <Button variant="outline" disabled={!!busy} onClick={doPdf}>{busy === 'pdf' ? tr('Making the PDF…') : tr('Download PDF')}</Button>
        </div>

        {canSend ? (
          <div className="print-toolbar" style={{ marginBlockStart: '0.75rem' }}>
            {whatsappByServer ? (
              <label>{tr('Customer WhatsApp')}
                <input type="tel" dir="ltr" value={phoneTo} onChange={(e) => setPhone(e.target.value)} placeholder="+20 100 000 0000" />
              </label>
            ) : null}
            <Button variant="outline" disabled={!!busy} onClick={doWhatsApp}>{whatsappByServer ? tr('Send by WhatsApp from the company') : tr('Send by WhatsApp')}</Button>
            <label>{tr('Customer email')}
              <input type="email" dir="ltr" value={emailTo} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </label>
            <Button variant="outline" disabled={!!busy || !looksLikeEmail(emailTo)} onClick={doEmail}>{emailByServer ? tr('Send by email from the company') : tr('Send by email')}</Button>
            <Button variant="ghost" disabled={!!busy} onClick={doCopy}>{tr('Copy link')}</Button>
            {linkStatus.data?.active ? (
              <>
                <Button variant="ghost" disabled={!!busy} onClick={doNewLink}>{tr('Make a new link')}</Button>
                <Button variant="ghost" disabled={!!busy} onClick={doRevoke}>{tr('Switch link off')}</Button>
              </>
            ) : null}
          </div>
        ) : null}
        {canSend && linkStatus.data?.active ? (
          <p className="muted small">{trf('The customer link is on. Opened {count} times.', { count: linkStatus.data.readCount ?? 0 })}</p>
        ) : null}
        {canSend && serverMode && !emailByServer ? <p className="muted small">{tr('Email from the company is not connected (Settings → Integrations), so email opens on your device.')}</p> : null}
        {canSend && serverMode && !whatsappByServer ? <p className="muted small">{tr('WhatsApp from the company waits for the approved invoice template, so WhatsApp opens on your phone.')}</p> : null}
        {q?.sends?.length ? <CompanySends sends={q.sends} onReload={queue.reload} /> : null}
      </div>

      <div className="print-root" ref={sheetRef}>
        <div className="print-stage">
          <PrintDocument data={d} options={{ layout: lay, language: lang }} />
        </div>
      </div>
    </section>
  );
}

const SEND_STATUS: Record<string, string> = {
  pending: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  expired: 'Not sent (expired)',
  cancelled: 'Cancelled',
};

/** The sends from the company and where each one is. Messages are cleaned up after a while; then the status is unknown. */
function CompanySends({ sends, onReload }: { sends: DocQueueSend[]; onReload: () => void }) {
  const session = useSession();
  return (
    <div style={{ marginBlockStart: '0.75rem' }}>
      <div className="section-head">
        <h2 className="related">{tr('Sent from the company')}</h2>
        <Button variant="ghost" size="sm" onClick={onReload}>{tr('Refresh')}</Button>
      </div>
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr('When')}</th><th scope="col">{tr('How')}</th><th scope="col">{tr('To')}</th><th scope="col">{tr('Status')}</th></tr></thead><tbody>
        {sends.map((s) => (
          <tr key={s.id}>
            <td className="nowrap">{formatDateTime(s.queuedAt, session.org)}</td>
            <td>{s.channel === 'email' ? tr('Email') : 'WhatsApp'}</td>
            <td dir="ltr">{s.channel === 'whatsapp' ? `+${s.recipient}` : s.recipient}</td>
            <td>{tr(SEND_STATUS[s.status] ?? 'Unknown')}{s.status === 'failed' && s.error ? <div className="muted small">{s.error}</div> : null}</td>
          </tr>
        ))}
      </tbody></table></div>
    </div>
  );
}

/** An issued invoice, or an approved note whose document can be sent; never a draft. */
function isSendable(d: DocPrintData): boolean {
  if (d.document.type === 'invoice') return d.document.status === 'issued';
  if (d.document.type === 'note') return d.document.status === 'approved';
  return false;
}

function BackLink({ type, id, invoiceId }: { type: PrintDocType; id: string; invoiceId: string | null }) {
  if (type === 'invoice') return <Link to={`/sales/invoices/${id}`} className="back-link">{tr('← Sales invoice')}</Link>;
  // An issued draft, and since sql/112 a credit or debit note, carry their invoice's id: go back to that invoice.
  if ((type === 'draft' || type === 'note') && invoiceId) return <Link to={`/sales/invoices/${invoiceId}`} className="back-link">{tr('← Sales invoice')}</Link>;
  // A draft not issued yet (or a note printed before sql/112 is applied) is usually opened from its invoice (dead-ends audit, 25 Nov).
  return <HistoryBackLink to="/sales/invoices" label={tr('← Sales invoices')} backLabel={tr('← Back')} />;
}
