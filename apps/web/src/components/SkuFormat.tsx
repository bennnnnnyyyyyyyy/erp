import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { demoMode } from '../lib/demo';
import { tr, trf } from '../lib/i18n';
import { previewSku, type SkuFormat } from '../lib/sku';
import { useSession } from '../session';
import { Button } from './ui/button';

type SkuInfo = { format: SkuFormat | null; next: string | null };

/** The company's item code format and the next free code (sql/075). Not loaded in the sample-data build, which has no such route. */
export function useSkuFormat() {
  const [info, setInfo] = useState<SkuInfo | null>(null);
  const reload = useCallback(() => {
    if (demoMode) return setInfo({ format: null, next: null });
    api<SkuInfo>('/v1/inventory/sku-format')
      .then(setInfo)
      .catch(() => setInfo({ format: null, next: null }));
  }, []);
  useEffect(reload, [reload]);
  return { info, reload, setInfo };
}

/** Only owners and admins may choose the format (the database checks again). */
export const useCanSetSkuFormat = (): boolean => {
  const role = useSession().role;
  return !demoMode && (role === 'owner' || role === 'admin');
};

/** Prefix and digits, with a live example. Saves once; every new item then gets the next code in this format. */
export function SkuFormatForm({ initial, onSaved, onCancel }: { initial: SkuFormat | null; onSaved: (info: SkuInfo) => void; onCancel?: () => void }) {
  const [prefix, setPrefix] = useState(initial?.prefix ?? 'ITM-');
  const [digits, setDigits] = useState(initial?.digits ?? 4);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Za-z0-9-]{0,12}$/.test(prefix);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<SkuInfo>('/v1/inventory/sku-format', { method: 'PUT', body: JSON.stringify({ prefix, digits }) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-card stack" role="group" aria-label={tr('Item code format')}>
      <p className="muted small">{tr('Choose how your item codes look. You do this once: every new item then gets the next code on its own, and you can still change it.')}</p>
      <div className="form-row">
        <label>
          {tr('Starts with')}
          <input maxLength={12} value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} aria-invalid={!valid || undefined} placeholder="ITM-" />
        </label>
        <label>
          {tr('Number of digits')}
          <select value={digits} onChange={(e) => setDigits(Number(e.target.value))}>
            {[3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small">{trf('Example: {code}', { code: previewSku(prefix, digits) })}</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="form-actions">
        <Button type="button" disabled={busy || !valid} onClick={() => void save()}>{busy ? tr('Saving…') : tr('Use this format')}</Button>
        {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>{tr('Skip')}</Button> : null}
      </div>
    </div>
  );
}

/** A small control for the items page header: the current format and a way to change it. */
export function SkuFormatControl({ onChanged }: { onChanged?: () => void }) {
  const canSet = useCanSetSkuFormat();
  const { info, setInfo } = useSkuFormat();
  const [open, setOpen] = useState(false);
  if (!canSet || !info) return null;
  return (
    <div className="muted small" style={{ marginBlock: '0.25rem' }}>
      {info.format ? (
        <>
          {trf('Item code format: {code}', { code: previewSku(info.format.prefix, info.format.digits) })}{' '}
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>{tr('SKU format')}</Button>
        </>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>{tr('Choose the SKU format')}</Button>
      )}
      {open ? (
        <SkuFormatForm
          initial={info.format}
          onCancel={() => setOpen(false)}
          onSaved={(next) => {
            setInfo(next);
            setOpen(false);
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
