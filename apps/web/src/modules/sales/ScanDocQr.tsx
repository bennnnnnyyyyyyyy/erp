import { useState } from 'react';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { Button } from '../../components/ui/button';
import { demoMode } from '../../lib/demo';
import { appPathFromScan } from '../../lib/docLink';
import { tr } from '../../lib/i18n';
import { navigate } from '../../lib/router';

// Scanning step 4: scan the QR code on one of our printed invoices or notes to open it here. Only our own pages on this same site are
// opened (lib/docLink.ts); the page itself loads through row level security, so another company's code opens nothing.
export function ScanDocQr() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (demoMode) return null;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => { setError(null); setOpen(true); }}>{tr('Scan an invoice QR code')}</Button>
      {error ? <p className="error notice small" role="alert">{error}</p> : null}
      {open ? (
        <BarcodeScanner
          title={tr('Scan an invoice QR code')}
          onClose={() => setOpen(false)}
          onCode={(code) => {
            setOpen(false);
            const path = appPathFromScan(code, window.location.origin);
            if (path) navigate(path);
            else setError(tr('This code does not open anything in this app. Scan the QR code printed on one of our invoices.'));
          }}
        />
      ) : null}
    </>
  );
}
