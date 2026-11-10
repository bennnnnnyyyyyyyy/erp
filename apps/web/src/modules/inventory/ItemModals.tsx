import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/Modal';
import { SkuFormatForm, useCanSetSkuFormat, useSkuFormat } from '../../components/SkuFormat';
import { UnitSelect } from '../../components/UnitSelect';
import { api } from '../../lib/api';
import type { DemoItem, DemoWarehouse } from '../../lib/demoInventory';
import { tr, trf } from '../../lib/i18n';

export function AddItemModal({ warehouses, onClose, onDone }: { warehouses: DemoWarehouse[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ sku: '', name: '', nameAr: '', uom: 'piece', openingQty: '0', warehouseId: warehouses[0]?.id ?? '', cost: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // The company's code format (sql/075): the next free code is filled in and stays editable. With no format yet, an owner or admin is asked once.
  const sku = useSkuFormat();
  const canSetFormat = useCanSetSkuFormat();
  const [skipFormat, setSkipFormat] = useState(false);
  const [touchedSku, setTouchedSku] = useState(false);
  useEffect(() => {
    if (sku.info?.next && !touchedSku) setForm((f) => ({ ...f, sku: sku.info?.next ?? f.sku }));
  }, [sku.info?.next, touchedSku]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/v1/inventory/items', { method: 'POST', body: JSON.stringify({ sku: form.sku, name: form.name, nameAr: form.nameAr, uom: form.uom, warehouseId: form.warehouseId, openingQty: Number(form.openingQty), unitCostMinor: form.cost.trim() ? Math.round(Number(form.cost) * 100) : null }) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={tr('Add item')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {sku.info && !sku.info.format && canSetFormat && !skipFormat ? (
          <SkuFormatForm initial={null} onSaved={(info) => sku.setInfo(info)} onCancel={() => setSkipFormat(true)} />
        ) : null}
        <div className="form-row">
          <label>SKU<input required value={form.sku} onChange={(e) => { setTouchedSku(true); set('sku')(e); }} /></label>
          <label>{tr('Unit')}<UnitSelect label={tr('Unit')} value={form.uom} onChange={(uom) => setForm((f) => ({ ...f, uom }))} /></label>
        </div>
        <label>{tr('Name')}<input required value={form.name} onChange={set('name')} /></label>
        <label>{tr('Name in Arabic (optional)')}<input dir="rtl" value={form.nameAr} onChange={set('nameAr')} /></label>
        <div className="form-row">
          <label>{tr('Opening stock (optional)')}<input type="number" min="0" value={form.openingQty} onChange={set('openingQty')} /></label>
          {/* sql/046: opening stock is a receipt, so it carries a unit cost (required once accounting is on). */}
          <label>{tr('Unit cost (needed with accounting)')}<input inputMode="decimal" placeholder="0.00" value={form.cost} onChange={set('cost')} /></label>
          <label>
            {tr('Warehouse')}
            <select value={form.warehouseId} onChange={set('warehouseId')}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><Button type="submit">{tr('Add item')}</Button></div>
      </form>
    </Modal>
  );
}

// Decision D4 (sql/062): fix an item's name later. The SKU and unit stay (documents and quantities depend on them); the old and new
// names are kept in the history.
export function EditItemModal({ item, onClose, onDone }: { item: DemoItem; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: item.name, nameAr: item.nameAr ?? '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/v1/inventory/items/${item.id}`, { method: 'PUT', body: JSON.stringify(form) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={trf('Edit {name}', { name: item.name })} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">
          {tr('The SKU and unit stay the same, because documents and quantities depend on them. Every change is kept in the history.')}{' '}
          <code>{item.sku}</code> · {item.uom}
        </p>
        <label>{tr('Name')}<input required value={form.name} onChange={set('name')} /></label>
        <label>{tr('Name in Arabic (optional)')}<input dir="rtl" value={form.nameAr} onChange={set('nameAr')} /></label>
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><Button type="submit">{tr('Save changes')}</Button></div>
      </form>
    </Modal>
  );
}

export function AddWarehouseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', nameAr: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/v1/inventory/warehouses', { method: 'POST', body: JSON.stringify(form) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={tr('Add warehouse')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">{tr('A warehouse is any place you keep stock: a store room, a cold room, a shelf area. Items are received into one.')}</p>
        <div className="form-row">
          <label>{tr('Short code')}<input required maxLength={32} placeholder="MAIN" value={form.code} onChange={set('code')} /></label>
          <label>{tr('Name')}<input required placeholder={tr('Main warehouse')} value={form.name} onChange={set('name')} /></label>
        </div>
        <label>{tr('Name in Arabic (optional)')}<input dir="rtl" value={form.nameAr} onChange={set('nameAr')} /></label>
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><Button type="submit">{tr('Add warehouse')}</Button></div>
      </form>
    </Modal>
  );
}

