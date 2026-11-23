import { useRef, useState } from 'react';
import {
  DOC_LANGUAGES,
  DOC_LAYOUTS,
  hasPermission,
  type DocLanguage,
  type DocLayout,
  type DocPrintData,
  type DocSettings,
  type PrintDocType,
  type SendDocType,
} from '@erp/shared';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { tr, trf } from '../../../lib/i18n';
import { Link, useParam } from '../../../lib/router';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';
import { PrintDocument } from './PrintDocument';
import { pdfName, saveBlob, sheetToPdf } from './pdf';
import { emailSubject, looksLikeEmail, mailtoUrl, sendMessage, waPhone, whatsappUrl } from './sendText';

// Print, download and send one document (step 1c). Drafts print with the DRAFT mark and cannot be sent. An issued invoice or an approved
// note can be sent by WhatsApp or email from the person's own device, with a private link the customer opens without signing in; the link
// works until the invoice is voided or someone switches it off. Each print, download and send is recorded (core_doc_sends) and audited.

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
  const settings = useLoad(() => api<DocSettings>('/v1/core/doc-settings').catch(() => null));
  const sendable = data.data ? isSendable(data.data) : false;
  const linkStatus = useLoad(() => (type !== 'draft' ? api<LinkStatus>(`/v1/sales/documents/${type}/${id}/link`).catch(() => null) : Promise.resolve(null)));
  const [layout, setLayout] = useState<DocLayout | null>(null);
  const [language, setLanguage] = useState<DocLanguage | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  if (data.error) return <section className="page"><BackLink type={type} id={id} invoiceId={null} /><Loading error={data.error} /></section>;
  if (!data.data) return <section className="page"><Loading /></section>;
  const d = data.data;
  const lay = layout ?? d.settings.layout;
  const lang = language ?? d.settings.language;
  const canSend = sendable && hasPermission(session.permissions, 'sales.invoices.send');
  const sendType = type as SendDocType;
  const companyName = d.company.legalName ?? d.company.name;
  const serverMode = settings.data?.sendMode === 'queue';

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
    window.print();
    await record('print');
    return null;
  });
  const doPdf = () => run('pdf', async () => {
    const el = sheet();
    if (!el) throw new Error(tr('This layout cannot be printed yet: fill in what is missing first.'));
    saveBlob(await sheetToPdf(el), pdfName(d.document.number));
    await record('download');
    return tr('PDF downloaded.');
  });
  const doWhatsApp = () => run('whatsapp', async () => {
    // Open the window first (browsers block a window opened after a wait), then point it at WhatsApp.
    const w = window.open('', '_blank');
    try {
      const url = await linkUrl();
      const phone = waPhone(d.customer?.phone);
      const target = whatsappUrl(phone, sendMessage(d.document, companyName, url, lang));
      if (w) w.location.href = target; else window.location.href = target;
      await record('whatsapp', phone ? `+${phone}` : undefined);
      return phone ? tr('WhatsApp opened with the message and the link. Press send there.') : tr('WhatsApp opened. The customer has no phone number: choose the chat there.');
    } catch (e) {
      w?.close();
      throw e;
    }
  });
  const doEmail = () => run('email', async () => {
    if (!looksLikeEmail(email)) throw new Error(tr('Type the customer’s email address first.'));
    const url = await linkUrl();
    window.location.href = mailtoUrl(email, emailSubject(d.document, companyName, lang), sendMessage(d.document, companyName, url, lang));
    await record('email', email.trim());
    return tr('Your email app opened with the message and the link. Press send there.');
  });
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
            <Button variant="outline" disabled={!!busy} onClick={doWhatsApp}>{tr('Send by WhatsApp')}</Button>
            <label>{tr('Customer email')}
              <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </label>
            <Button variant="outline" disabled={!!busy || !looksLikeEmail(email)} onClick={doEmail}>{tr('Send by email')}</Button>
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
        {canSend && serverMode ? <p className="muted small">{tr('Your company chose to send from its own WhatsApp or email. That part is not ready yet, so these buttons send from your device.')}</p> : null}
      </div>

      <div className="print-root" ref={sheetRef}>
        <div className="print-stage">
          <PrintDocument data={d} options={{ layout: lay, language: lang }} />
        </div>
      </div>
    </section>
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
  if (type === 'draft' && invoiceId) return <Link to={`/sales/invoices/${invoiceId}`} className="back-link">{tr('← Sales invoice')}</Link>;
  return <Link to="/sales/invoices" className="back-link">{tr('← Sales invoices')}</Link>;
}
