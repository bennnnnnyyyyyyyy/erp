import { useState } from 'react';
import {
  DOC_DIGITS,
  DOC_LANGUAGES,
  DOC_LAYOUTS,
  DOC_LETTERHEAD_MAX_CHARS,
  DOC_LOGO_MAX_CHARS,
  DOC_SEND_MODES,
  type DocDigits,
  type DocLanguage,
  type DocLayout,
  type DocPrintData,
  type DocSendMode,
  type DocSettings,
} from '@erp/shared';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { tr } from '../../../lib/i18n';
import { useLoad } from '../../../lib/useLoad';
import { PrintDocument } from '../../sales/print/PrintDocument';
import { isPdfFile, letterheadFromPdf } from './letterheadPdf';

// Settings > Invoices and documents (sql/103): the company's own look on its invoices and notes. Owners and admins. A live preview with a
// sample invoice shows the letterhead and its margins. This is the customer's branding on its own paper; the app itself looks like Bellvox.

const LAYOUT_LABEL: Record<DocLayout, string> = { simple: 'Simple', detailed: 'Detailed (VAT on each line)', eta: 'ETA layout' };
const LANGUAGE_LABEL: Record<DocLanguage, string> = { ar: 'Arabic', en: 'English', both: 'Arabic and English' };
const DIGITS_LABEL: Record<DocDigits, string> = { latn: 'Western digits (1 2 3)', arab: 'Arabic-Indic digits (١ ٢ ٣)' };
const SEND_LABEL: Record<DocSendMode, string> = {
  device: 'From the person’s own phone or computer (WhatsApp or email app)',
  queue: 'From the company’s connected WhatsApp Business or email (coming next; until then, from the device)',
};

function readImage(file: File, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return reject(new Error(tr('Choose a PNG, JPEG or WebP picture.')));
    const r = new FileReader();
    r.onload = () => {
      const v = String(r.result ?? '');
      if (v.length > max) reject(new Error(tr('The picture is too large. Make it smaller and try again.')));
      else resolve(v);
    };
    r.onerror = () => reject(new Error(tr('The picture could not be read.')));
    r.readAsDataURL(file);
  });
}

/** A sample invoice for the preview: the company's real settings, made-up lines. */
function sample(s: DocSettings): DocPrintData {
  return {
    document: { type: 'invoice', kind: 'invoice', id: 'sample', number: 'INV-2026-00001', status: 'issued', date: new Date().toISOString().slice(0, 10), dueDate: null, currency: 'EGP', netMinor: 150000, taxMinor: 21000, grossMinor: 171000, issuedAt: null, orderNumber: 'SO-0001', invoiceNumber: null, reason: null },
    lines: [
      { itemId: 'a', sku: 'ITEM-1', name: tr('Sample item'), uom: 'piece', qty: 10, unit: null, unitFactor: null, unitPriceMinor: 10000, priceIncludesVat: false, taxRate: 14, netMinor: 100000, taxMinor: 14000, taxType: 'T1', taxSubType: 'V009', etaItemType: 'EGS', etaItemCode: 'EG-000000000-1', etaUnitCode: 'EA' },
      { itemId: 'b', sku: 'ITEM-2', name: tr('Another item'), uom: 'piece', qty: 5, unit: null, unitFactor: null, unitPriceMinor: 10000, priceIncludesVat: false, taxRate: 14, netMinor: 50000, taxMinor: 7000, taxType: 'T1', taxSubType: 'V009', etaItemType: 'EGS', etaItemCode: 'EG-000000000-2', etaUnitCode: 'EA' },
    ],
    customer: { name: tr('Sample customer'), contact: null, city: null, phone: '+20 100 000 0000', code: null, taxIdType: 'B', taxId: '100000000', country: 'EG', governate: null, regionCity: null, street: null, buildingNumber: null },
    company: { name: tr('Your company'), legalName: null, taxNumber: '000000000', activityCode: '0000', vatRegistered: true, branch: null },
    settings: s,
  };
}

export function DocumentSettings() {
  const loaded = useLoad(() => api<DocSettings>('/v1/core/doc-settings'));
  const [draft, setDraft] = useState<DocSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);   // a PDF letterhead is being turned into a picture
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!loaded.data) return <section className="page"><Loading error={loaded.error} /></section>;
  const s = draft ?? loaded.data;
  const set = (patch: Partial<DocSettings>) => setDraft({ ...s, ...patch });
  const changed = draft !== null;

  async function pick(kind: 'logo' | 'letterhead', file: File | undefined) {
    if (!file) return;
    setMessage(null);
    try {
      // A letterhead may also be a one-page PDF: it is turned into a picture of the page here, in the browser.
      if (kind === 'letterhead' && isPdfFile(file)) {
        setReading(true);
        set({ letterhead: await letterheadFromPdf(file, DOC_LETTERHEAD_MAX_CHARS) });
        setMessage({ ok: true, text: tr('The PDF letterhead was turned into a picture of the page. Check the preview, then save.') });
      } else {
        set({ [kind]: await readImage(file, kind === 'logo' ? DOC_LOGO_MAX_CHARS : DOC_LETTERHEAD_MAX_CHARS) });
      }
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setMessage(null);
    try {
      await api<DocSettings>('/v1/core/doc-settings', { method: 'PUT', body: JSON.stringify(draft) });
      setDraft(null);
      loaded.reload();
      setMessage({ ok: true, text: tr('Saved.') });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page wide">
      <h1>{tr('Invoices and documents')}</h1>
      <p className="muted">{tr('How your invoices and credit and debit notes look when you print, download or send them. Your logo or letterhead, your texts, the language and the digits.')}</p>
      {message && <p className={message.ok ? 'notice' : 'error notice'} role="status">{message.text}</p>}

      <div className="form-row">
        <label>{tr('Logo (PNG, JPEG or WebP, up to about 300 KB)')}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void pick('logo', e.target.files?.[0])} />
        </label>
        {s.logo ? <Button variant="ghost" size="sm" onClick={() => set({ logo: null })}>{tr('Remove logo')}</Button> : null}
      </div>
      <div className="form-row">
        <label>{tr('Letterhead: your whole A4 paper, as a one-page PDF or a picture (PNG, JPEG or WebP, up to about 1.5 MB)')}
          <input type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" disabled={reading} onChange={(e) => void pick('letterhead', e.target.files?.[0])} />
        </label>
        {reading ? <span className="muted small" role="status">{tr('Reading the PDF…')}</span> : null}
        {s.letterhead ? <Button variant="ghost" size="sm" onClick={() => set({ letterhead: null })}>{tr('Remove letterhead')}</Button> : null}
      </div>
      {s.letterhead ? (
        <div className="form-row">
          <label>{tr('Space at the top (mm)')}<input type="number" min={0} max={150} value={s.marginTopMm} onChange={(e) => set({ marginTopMm: Number(e.target.value) })} /></label>
          <label>{tr('Space at the bottom (mm)')}<input type="number" min={0} max={150} value={s.marginBottomMm} onChange={(e) => set({ marginBottomMm: Number(e.target.value) })} /></label>
        </div>
      ) : null}
      <label>{tr('Text under the company name (address, phone)')}<textarea rows={2} maxLength={1000} value={s.headerText ?? ''} onChange={(e) => set({ headerText: e.target.value })} /></label>
      <label>{tr('Payment terms')}<textarea rows={2} maxLength={500} value={s.paymentTerms ?? ''} onChange={(e) => set({ paymentTerms: e.target.value })} /></label>
      <label>{tr('Bank details')}<textarea rows={3} maxLength={1000} value={s.bankDetails ?? ''} onChange={(e) => set({ bankDetails: e.target.value })} /></label>
      <label>{tr('Footer text')}<textarea rows={2} maxLength={1000} value={s.footerText ?? ''} onChange={(e) => set({ footerText: e.target.value })} /></label>
      <div className="form-row">
        <label>{tr('Language of the documents')}
          <select value={s.language} onChange={(e) => set({ language: e.target.value as DocLanguage })}>{DOC_LANGUAGES.map((l) => <option key={l} value={l}>{tr(LANGUAGE_LABEL[l])}</option>)}</select>
        </label>
        <label>{tr('Digits')}
          <select value={s.digits} onChange={(e) => set({ digits: e.target.value as DocDigits })}>{DOC_DIGITS.map((l) => <option key={l} value={l}>{tr(DIGITS_LABEL[l])}</option>)}</select>
        </label>
        <label>{tr('Default layout')}
          <select value={s.layout} onChange={(e) => set({ layout: e.target.value as DocLayout })}>{DOC_LAYOUTS.map((l) => <option key={l} value={l}>{tr(LAYOUT_LABEL[l])}</option>)}</select>
        </label>
      </div>
      <label>{tr('How “Send” works')}
        <select value={s.sendMode ?? 'device'} onChange={(e) => set({ sendMode: e.target.value as DocSendMode })}>{DOC_SEND_MODES.map((m) => <option key={m} value={m}>{tr(SEND_LABEL[m])}</option>)}</select>
      </label>
      <div className="form-actions" style={{ marginBlock: '1rem' }}>
        <Button disabled={busy || reading || !changed} onClick={save}>{busy ? tr('Saving…') : tr('Save')}</Button>
        {changed ? <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>{tr('Undo changes')}</Button> : null}
      </div>

      <h2 className="related">{tr('Preview')}</h2>
      <div className="print-stage">
        <PrintDocument data={sample(s)} options={{ layout: s.layout === 'eta' ? 'detailed' : s.layout, language: s.language }} />
      </div>
    </section>
  );
}
