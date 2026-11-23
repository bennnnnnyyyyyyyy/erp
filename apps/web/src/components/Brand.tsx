import { useEffect, useState } from 'react';
import { hasPermission } from '@erp/shared';
import { api } from '../lib/api';
import { BRAND } from '../lib/brand';
import { demoMode } from '../lib/demo';
import { useSession } from '../session';

/** The product's word mark ("Bellvox") and "ERP". On a phone only the square mark shows (styles.css). */
export function ProductLogo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={`product-logo product-logo-${size}`}>
      <img className="product-logo-word" src={BRAND.logo} alt={BRAND.name} />
      <img className="product-logo-mark" src={BRAND.mark} alt="" aria-hidden="true" />
      <span className="product-logo-suffix" aria-hidden="true">{BRAND.suffix}</span>
    </span>
  );
}

// The company's own logo (Settings > Documents, the same picture as on its invoices). Read once per company per page load; a company
// without a logo, a person who may not read the company settings, or a server without that setting simply shows no picture.
const logos = new Map<string, Promise<string | null>>();
function companyLogo(orgId: string): Promise<string | null> {
  let p = logos.get(orgId);
  if (!p) {
    p = api<{ logo?: string | null }>('/v1/core/doc-settings').then((s) => (typeof s?.logo === 'string' && s.logo.startsWith('data:image/') ? s.logo : null)).catch(() => null);
    logos.set(orgId, p);
  }
  return p;
}

export function CompanyLogo() {
  const session = useSession();
  const orgId = session.org?.id ?? null;
  const canRead = hasPermission(session.permissions, 'core.org.read');
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (demoMode || !orgId || !canRead) return;
    let live = true;
    void companyLogo(orgId).then((logo) => live && setSrc(logo));
    return () => {
      live = false;
    };
  }, [orgId, canRead]);
  return src ? <img className="company-logo" src={src} alt="" /> : null;
}
