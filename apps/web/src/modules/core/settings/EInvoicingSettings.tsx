import { useState, type FormEvent } from 'react';
import { hasPermission } from '@erp/shared';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { tr, trf } from '../../../lib/i18n';
import { Link } from '../../../lib/router';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';

// E-invoicing settings (Ben, 25 Nov 2026): the company's tax registration for the Egyptian Tax Authority and the branch address that
// prints on ETA invoices. The API existed (PUT /v1/einvoicing/profile, POST/PUT /v1/einvoicing/branches) but no screen called it, so
// the ETA print layout asked for fields nobody could enter. Read with einvoicing.settings.read, change with einvoicing.settings.manage.
// Sending invoices to the ETA is not built yet; "Live" mode is refused by the server until credentials and a signer are set up.

type Profile = { registrationNumber: string; legalName: string; activityCode: string; mode: string };
type Branch = {
  id: string;
  branchCode: string;
  name: string;
  governate: string;
  regionCity: string;
  street: string;
  buildingNumber: string;
  postalCode: string | null;
  floor: string | null;
  room: string | null;
  landmark: string | null;
  additionalInformation: string | null;
};
type Settings = { profile: Profile | null; branches: Branch[] };
type Readiness = { items: { total: number; missingCodes: number }; customers: { total: number; missingTaxIdentity: number } };

const EMPTY_PROFILE: Profile = { registrationNumber: '', legalName: '', activityCode: '', mode: 'preprod' };
const EMPTY_BRANCH: Omit<Branch, 'id'> = {
  branchCode: '0', name: '', governate: '', regionCity: '', street: '', buildingNumber: '', postalCode: '', floor: '', room: '', landmark: '', additionalInformation: '',
};

export function EInvoicingSettings() {
  const session = useSession();
  const on = session.modules.includes('einvoicing');
  const canManage = hasPermission(session.permissions, 'einvoicing.settings.manage');
  const settings = useLoad(() => (on ? api<Settings>('/v1/einvoicing/settings') : Promise.resolve(null)));
  const readiness = useLoad(() => (on ? api<Readiness>('/v1/einvoicing/readiness').catch(() => null) : Promise.resolve(null)));

  if (!on) {
    return (
      <section className="page">
        <h1>{tr('E-invoicing')}</h1>
        <p className="notice">{tr('The E-invoicing app is switched off for your company.')} <Link to="/settings/apps">{tr('Apps')}</Link></p>
      </section>
    );
  }
  if (!settings.data) return <section className="page"><Loading error={settings.error} /></section>;
  const branch = settings.data.branches[0] ?? null;

  return (
    <section className="page">
      <h1>{tr('E-invoicing')}</h1>
      <p className="muted">{tr('Your company details for the Egyptian Tax Authority (ETA). They print on invoices with the ETA layout. Sending invoices to the ETA is not switched on yet.')}</p>
      {!canManage && <p className="notice">{tr('Only an owner or admin can change these details.')}</p>}
      <ProfileForm key={JSON.stringify(settings.data.profile)} profile={settings.data.profile ?? EMPTY_PROFILE} saved={!!settings.data.profile} canManage={canManage} onSaved={settings.reload} />
      <BranchForm key={branch?.id ?? 'new'} branch={branch} canManage={canManage} onSaved={settings.reload} />
      {readiness.data && (
        <div className="form-card stack">
          <h2 className="related">{tr('Before ETA invoices can print')}</h2>
          <p style={{ marginBlock: 0 }}>
            {readiness.data.items.missingCodes > 0
              ? trf('{n} of {total} items have no ETA item code or unit.', { n: readiness.data.items.missingCodes, total: readiness.data.items.total })
              : tr('Every item has its ETA codes.')}{' '}
            {readiness.data.items.missingCodes > 0 && <Link to="/inventory/stock">{tr('Stock on hand')}</Link>}
          </p>
          <p style={{ marginBlock: 0 }}>
            {readiness.data.customers.missingTaxIdentity > 0
              ? trf('{n} of {total} customers have no tax identity.', { n: readiness.data.customers.missingTaxIdentity, total: readiness.data.customers.total })
              : tr('Every customer has a tax identity.')}{' '}
            {readiness.data.customers.missingTaxIdentity > 0 && <Link to="/sales/customers">{tr('Customers')}</Link>}
          </p>
        </div>
      )}
    </section>
  );
}

function ProfileForm({ profile, saved, canManage, onSaved }: { profile: Profile; saved: boolean; canManage: boolean; onSaved: () => void }) {
  const [form, setForm] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof Profile) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api('/v1/einvoicing/profile', { method: 'PUT', body: JSON.stringify(form) });
      setMessage({ ok: true, text: tr('Saved.') });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card stack" onSubmit={submit}>
      <h2 className="related">{tr('Tax registration')}</h2>
      {!saved && <p className="muted small" style={{ marginBlock: 0 }}>{tr('Not saved yet.')}</p>}
      <div className="form-row">
        <label>{tr('Tax registration number')}<input required disabled={!canManage} value={form.registrationNumber} onChange={set('registrationNumber')} inputMode="numeric" dir="ltr" /></label>
        <label>{tr('Legal name')}<input required disabled={!canManage} value={form.legalName} onChange={set('legalName')} /></label>
        <label>{tr('ETA activity code')}<input required disabled={!canManage} value={form.activityCode} onChange={set('activityCode')} inputMode="numeric" dir="ltr" /></label>
        <label>{tr('Mode')}
          <select disabled={!canManage} value={form.mode} onChange={set('mode')}>
            <option value="preprod">{tr('Test (pre-production)')}</option>
            <option value="production">{tr('Live (production)')}</option>
          </select>
        </label>
      </div>
      {message && <p className={message.ok ? 'notice' : 'error notice'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
      {canManage && <div><Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save')}</Button></div>}
    </form>
  );
}

function BranchForm({ branch, canManage, onSaved }: { branch: Branch | null; canManage: boolean; onSaved: () => void }) {
  const [form, setForm] = useState<Omit<Branch, 'id'>>(() => {
    if (!branch) return EMPTY_BRANCH;
    const { id: _id, ...rest } = branch;
    return rest;
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof Omit<Branch, 'id'>) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const field = (k: keyof Omit<Branch, 'id'>, label: string, required = false) => (
    <label>{tr(label)}<input required={required} disabled={!canManage} value={form[k] ?? ''} onChange={set(k)} /></label>
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api(branch ? `/v1/einvoicing/branches/${branch.id}` : '/v1/einvoicing/branches', { method: branch ? 'PUT' : 'POST', body: JSON.stringify({ ...form, country: 'EG' }) });
      setMessage({ ok: true, text: tr('Saved.') });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card stack" onSubmit={submit}>
      <h2 className="related">{tr('Branch address on ETA invoices')}</h2>
      <p className="muted small" style={{ marginBlock: 0 }}>{tr('The address the ETA has for your company. The main branch has code 0.')}</p>
      <div className="form-row">
        {field('branchCode', 'Branch code', true)}
        {field('name', 'Branch name', true)}
        {field('governate', 'Governorate', true)}
        {field('regionCity', 'Region or city', true)}
      </div>
      <div className="form-row">
        {field('street', 'Street', true)}
        {field('buildingNumber', 'Building number', true)}
        {field('postalCode', 'Postal code')}
        {field('floor', 'Floor')}
      </div>
      <div className="form-row">
        {field('room', 'Room')}
        {field('landmark', 'Landmark')}
        {field('additionalInformation', 'More information')}
      </div>
      {message && <p className={message.ok ? 'notice' : 'error notice'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
      {canManage && <div><Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save')}</Button></div>}
    </form>
  );
}
