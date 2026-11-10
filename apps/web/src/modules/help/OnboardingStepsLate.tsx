import { useEffect, useState, type FormEvent } from 'react';
import { hasPermission } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { Link, navigate } from '../../lib/router';
import { useSession } from '../../session';
import {
  BUSINESS_TYPES,
  onboardingContent,
  readProgress,
  STEP_KEYS,
  stepsFor,
  writeProgress,
  type BusinessType,
  type OnboardingContent,
} from './onboardingContent';
import {
  SAMPLE_APPROVAL,
  SAMPLE_COMPANY,
  SAMPLE_CONDITIONS,
  SAMPLE_CUSTOMERS,
  SAMPLE_ITEMS,
  SAMPLE_SUPPLIERS,
  SAMPLE_WAREHOUSES,
  type SampleCondition,
  type SampleItem,
  type SampleParty,
  type SampleWarehouse,
} from './sampleCompany';
import {
  canFillSample,
  FILL_STAGES,
  fillEverything,
  saveConditions,
  saveItems,
  saveParties,
  saveWarehouses,
  type FillStage,
  type OnProgress,
  type Report,
} from './sampleFill';
import { SkuFormatForm, useCanSetSkuFormat, useSkuFormat } from '../../components/SkuFormat';
import { followingCodes } from '../../lib/sku';
import { startTour } from './TourHost';
import { InviteLinkBox } from '../core/settings/UsersSettings';
import { inputClass, useList, Field } from './onboardingShared';
import { FillButton, useSave, useRowsSave, RowsSaver, RowsTable } from './onboardingParts';
import { Saver } from './OnboardingStepsEarly';

/** A table row for items: cost is typed in currency units (e.g. 24.00) and kept as minor units on save. */
export type ItemRow = Omit<SampleItem, 'costMinor'> & { cost: number | null };
export const toItemRow = (x: SampleItem): ItemRow => ({ sku: x.sku, name: x.name, nameAr: x.nameAr, uom: x.uom, warehouse: x.warehouse, condition: x.condition, openingQty: x.openingQty, cost: x.costMinor / 100 });
// Two decimals, as for EGP and most currencies here. (A three-decimal currency such as KWD would need the currency's own exponent.)
export const fromItemRow = (r: ItemRow): SampleItem => ({ ...r, openingQty: Number(r.openingQty) || 0, costMinor: Math.round((Number(r.cost) || 0) * 100) });

export function ItemsStep({ c, business, onDone }: { c: OnboardingContent; business: BusinessType | null; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'inventory.items.manage');
  const readable = hasPermission(session.permissions, 'inventory.items.read');
  const items = useList<{ id: string }>('/v1/inventory/items', readable, 0);
  const warehouses = useList<{ id: string; code: string }>('/v1/inventory/warehouses', readable, 0);
  const conditions = useList<{ id: string; name: string }>('/v1/inventory/storage-conditions', hasPermission(session.permissions, 'inventory.batches.read'), 0);
  // The company's item code format (sql/075): new rows get the next free codes on their own and stay editable. With no format yet,
  // an owner or admin is asked once, above the table.
  const sku = useSkuFormat();
  const canSetFormat = useCanSetSkuFormat();
  const last = (rs: ItemRow[]) => [...rs].reverse().find((r) => r.sku.trim())?.sku.trim() ?? '';
  const blank = (after: ItemRow[] = []): ItemRow => ({
    sku: sku.info?.format && last(after) ? (followingCodes(last(after), 2)[1] ?? '') : '',
    name: '',
    nameAr: '',
    uom: 'piece',
    warehouse: warehouses?.[0]?.code ?? '',
    condition: '',
    openingQty: 0,
    cost: null,
  });
  const [rows, setRows] = useState<ItemRow[]>(() => [blank(), blank(), blank()]);
  useEffect(() => {
    const next = sku.info?.next;
    if (next) setRows((rs) => (rs.some((r) => r.sku.trim()) ? rs : rs.map((r, i) => ({ ...r, sku: followingCodes(next, rs.length)[i] ?? '' }))));
  }, [sku.info?.next]);
  const saver = useRowsSave(onDone);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const filled = rows.filter((r) => r.sku.trim() && r.name.trim());
  return (
    <>
      <FillButton c={c} onFill={() => setRows(SAMPLE_ITEMS.map(toItemRow))} />
      {business ? <p className="m-0 mb-2 text-sm text-muted-foreground">{c.business.unitHint[business]}</p> : null}
      {items && items.length > 0 ? <p className="m-0 mb-2 text-sm">{c.items.existing(items.length)}</p> : null}
      <datalist id="onb-warehouses">
        {(warehouses ?? []).map((x) => (
          <option key={x.id} value={x.code} />
        ))}
      </datalist>
      <datalist id="onb-item-conditions">
        {(conditions ?? []).map((x) => (
          <option key={x.id} value={x.name} />
        ))}
      </datalist>
      {sku.info && !sku.info.format && canSetFormat ? <SkuFormatForm initial={null} onSaved={(info) => sku.setInfo(info)} /> : null}
      <RowsTable<ItemRow>
        cols={[
          { key: 'sku', label: c.items.sku, width: '9rem' },
          { key: 'name', label: c.items.name },
          { key: 'nameAr', label: c.items.nameAr, optional: true },
          { key: 'uom', label: c.items.unit, unit: true, width: '9rem' },
          // Was labelled "Code" like the SKU, so the table showed two code columns (walkthrough, 10 Nov 2026).
          { key: 'warehouse', label: c.items.warehouse, list: 'onb-warehouses', width: '8rem' },
          { key: 'openingQty', label: c.items.opening, type: 'number', width: '8rem', optional: true },
          { key: 'cost', label: c.items.cost, type: 'number', width: '8rem', optional: true },
          { key: 'condition', label: c.warehouse.condition, list: 'onb-item-conditions', width: '10rem', optional: true },
        ]}
        rows={rows}
        setRows={setRows}
        blank={() => blank(rows)}
        addLabel={c.items.addRow}
        optionalLabel={c.optional}
      />
      <RowsSaver c={c} s={saver} disabled={filled.length === 0} onSave={() => saver.run((p) => saveItems(api, filled.map(fromItemRow), p))} />
    </>
  );
}

export function PartyStep({ c, kind, onDone }: { c: OnboardingContent; kind: 'suppliers' | 'customers'; onDone: () => void }) {
  const session = useSession();
  const path = kind === 'suppliers' ? '/v1/purchasing/suppliers' : '/v1/sales/customers';
  const can = hasPermission(session.permissions, kind === 'suppliers' ? 'purchasing.suppliers.manage' : 'sales.customers.manage');
  const readable = hasPermission(session.permissions, kind === 'suppliers' ? 'purchasing.suppliers.read' : 'sales.customers.read');
  const existing = useList<{ id: string }>(path, readable, 0);
  const blank = (): SampleParty => ({ name: '', contact: '', city: '' });
  const [rows, setRows] = useState<SampleParty[]>([blank()]);
  const saver = useRowsSave(onDone);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const filled = rows.filter((r) => r.name.trim());
  const sample = kind === 'suppliers' ? SAMPLE_SUPPLIERS : SAMPLE_CUSTOMERS;
  return (
    <>
      <FillButton c={c} onFill={() => setRows(sample.map((x) => ({ ...x })))} />
      {existing && existing.length > 0 ? <p className="m-0 mb-2 text-sm">{c.party.existing(existing.length)}</p> : null}
      <RowsTable<SampleParty>
        cols={[
          { key: 'name', label: c.party.name },
          { key: 'contact', label: c.party.contact, optional: true },
          { key: 'city', label: c.party.city, width: '10rem', optional: true },
        ]}
        rows={rows}
        setRows={setRows}
        blank={blank}
        addLabel={c.items.addRow}
        optionalLabel={c.optional}
      />
      <RowsSaver c={c} s={saver} disabled={filled.length === 0} onSave={() => saver.run((p) => saveParties(api, path, filled, p))} />
    </>
  );
}

export function TeamStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'core.users.manage');
  const [version, setVersion] = useState(0);
  const members = useList<{ id: string }>('/v1/core/members', hasPermission(session.permissions, 'core.users.read'), version);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [sent, setSent] = useState<string[]>([]);
  // Nothing is emailed: the server makes a sign-in link and the owner sends it (UX audit: the wizard said "Invitation sent" and threw it away).
  const [link, setLink] = useState<{ email: string; link: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!can) return <p className="m-0 text-sm text-muted-foreground">{c.notAllowed}</p>;
  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ inviteLink?: string; member?: { email: string } }>('/v1/core/members', { method: 'POST', body: JSON.stringify({ email: email.trim(), role, name: fullName.trim() }) });
      if (r.inviteLink) setLink({ email: email.trim(), link: r.inviteLink });
      setSent((s) => [...s, email.trim()]);
      setEmail('');
      setFullName('');
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  return (
    <form onSubmit={invite} className="grid gap-4 sm:grid-cols-2">
      {members ? <p className="m-0 text-sm sm:col-span-2">{c.team.existing(members.length)}</p> : null}
      <Field label={c.team.email}>
        <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
      </Field>
      <Field label={c.team.fullName}>
        <input className={inputClass} required maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />
      </Field>
      <Field label={c.team.role}>
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {(['admin', 'member', 'viewer'] as const).map((r) => (
            <option key={r} value={r}>
              {c.team.roles[r]}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="outline" disabled={busy || !email.trim() || !fullName.trim()}>
          {busy ? c.saving : c.team.invite}
        </Button>
      </div>
      {error ? (
        <p className="error m-0 sm:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
      {link ? (
        <div className="sm:col-span-2">
          <InviteLinkBox email={link.email} link={link.link} onClose={() => setLink(null)} />
        </div>
      ) : null}
      {sent.length > 0 ? (
        <ul className="m-0 list-disc ps-5 text-sm sm:col-span-2">
          {sent.map((x) => (
            <li key={x}>{c.team.invited(x)}</li>
          ))}
        </ul>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="button" onClick={onDone}>
          {c.next}
        </Button>
      </div>
    </form>
  );
}

export function ApprovalStep({ c, onDone }: { c: OnboardingContent; onDone: () => void }) {
  const session = useSession();
  const can = hasPermission(session.permissions, 'inventory.approval_policies.manage');
  const existing = useList<{ id: string }>('/v1/inventory/approval-policies', hasPermission(session.permissions, 'inventory.items.read'), 0);
  const [minQty, setMinQty] = useState('');
  const [approvers, setApprovers] = useState(2);
  const { busy, error, run } = useSave(onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/v1/inventory/approval-policies', {
        method: 'POST',
        body: JSON.stringify({ minTotalQty: Number(minQty), requiredApprovals: approvers, warehouseId: null }),
      });
    });
  };
  return (
    <>
      <p className="m-0 rounded-lg bg-muted p-3 text-sm">{c.approval.always}</p>
      {!can ? (
        <p className="m-0 mt-3 text-sm text-muted-foreground">{c.notAllowed}</p>
      ) : (
        <div className="mt-4">
          <FillButton
            c={c}
            onFill={() => {
              setMinQty(String(SAMPLE_APPROVAL.minTotalQty));
              setApprovers(SAMPLE_APPROVAL.requiredApprovals);
            }}
          />
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            {existing && existing.length > 0 ? <p className="m-0 text-sm sm:col-span-2">{c.approval.existing(existing.length)}</p> : null}
            <Field label={c.approval.minQty} hint={c.approval.minQtyHint}>
              <input className={inputClass} type="number" min={0} step="any" required value={minQty} onChange={(e) => setMinQty(e.target.value)} />
            </Field>
            <Field label={c.approval.approvers}>
              <select className={inputClass} value={approvers} onChange={(e) => setApprovers(Number(e.target.value))}>
                {[2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Saver c={c} busy={busy} error={error} disabled={minQty === '' || !(Number(minQty) >= 0)} />
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function DoneStep({ c, orgId, step, business }: { c: OnboardingContent; orgId: string; step: number; business: BusinessType | null }) {
  useEffect(() => {
    writeProgress(orgId, { step, done: true, business });
  }, [orgId, step, business]);
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        onClick={() => {
          navigate('/');
          startTour();
        }}
      >
        {c.done.tour}
      </Button>
      <Button variant="outline" onClick={() => navigate('/')}>
        {c.done.home}
      </Button>
      <Link to="/start" className="self-center text-sm">
        {c.done.checklist}
      </Link>
    </div>
  );
}
