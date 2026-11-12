import type { ReactNode } from 'react';

// Line icons for apps (home tiles and the top bar) and for each page in an app's menu. Drawn here (no icon library, no copied icon
// set): 24x24, stroke only, so they follow the text colour in light and dark mode and need no flipping in right-to-left layouts.

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const svg = (...paths: ReactNode[]) => <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>{paths}</svg>;

const APP: Record<string, ReactNode> = {
  inventory: svg(<path key="a" d="M3 8l9-5 9 5v8l-9 5-9-5V8z" />, <path key="b" d="M3 8l9 5 9-5M12 13v8" />),
  tasks: svg(<path key="a" d="M9 11l2 2 4-4" />, <rect key="b" x="4" y="4" width="16" height="16" rx="2.5" />),
  messaging: svg(<path key="a" d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8" />, <path key="b" d="M10.3 20a1.9 1.9 0 003.4 0" />),
  purchasing: svg(<path key="a" d="M3 4h2l2.2 10.2a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.1L21 8H6.2" />, <circle key="b" cx="9.5" cy="19.5" r="1.3" />, <circle key="c" cx="17" cy="19.5" r="1.3" />),
  sales: svg(<path key="a" d="M4 17l5-5 4 4 7-7" />, <path key="b" d="M15 9h5v5" />),
  finance: svg(<rect key="a" x="3" y="6" width="18" height="13" rx="2.5" />, <path key="b" d="M3 10h18M7 15h3" />),
  alerts: svg(<path key="a" d="M12 3l9.5 17h-19L12 3z" />, <path key="b" d="M12 10v4.5M12 17.3v.2" />),
  guide: svg(<path key="a" d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5v-15z" />, <path key="b" d="M4 20.5A2.5 2.5 0 006.5 23H20v-5" />),
  start: svg(<circle key="a" cx="12" cy="12" r="9" />, <path key="b" d="M10 8.5l5.5 3.5-5.5 3.5v-7z" />),
  settings: svg(<circle key="a" cx="12" cy="12" r="3" />, <path key="b" d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />),
};

/** The app's icon, or its first letter for an app without one. */
export function AppIcon({ appKey, name }: { appKey: string; name: string }) {
  return <>{APP[appKey] ?? <span className="icon-letter">{name.slice(0, 1)}</span>}</>;
}

// Page icons, chosen by a word in the page's path (first match wins), so a new page gets a sensible icon without editing this file.
const PAGE: [RegExp, ReactNode][] = [
  // Inventory "Do" pages: goods coming in (arrow down into a tray) and going out (arrow up out of one).
  [/^\/receive$/, svg(<path key="a" d="M12 3v11M8 10l4 4 4-4" />, <path key="b" d="M4 15v4h16v-4" />)],
  [/^\/requests\/new$/, svg(<path key="a" d="M12 14V3M8 7l4-4 4 4" />, <path key="b" d="M4 15v4h16v-4" />)],
  [/requests/, svg(<path key="a" d="M4 13l2.5-8h11L20 13v6H4z" />, <path key="b" d="M4 13h5l1 2h4l1-2h5" />)],
  [/transfers|in-transit/, svg(<path key="a" d="M4 8h13l-3-3M20 16H7l3 3" />)],
  [/ledger/, svg(<path key="a" d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z" />, <path key="b" d="M9 9h6M9 13h6" />)],
  [/forecast/, svg(<path key="a" d="M4 19h16" />, <path key="b" d="M5 15l4-4 3 3 6-7" />, <path key="c" d="M15 7h3v3" />)],
  [/batches|expiry/, svg(<rect key="a" x="4" y="5" width="16" height="15" rx="2" />, <path key="b" d="M4 10h16M9 3v4M15 3v4" />)],
  [/reorder/, svg(<path key="a" d="M20 12a8 8 0 11-2.3-5.6" />, <path key="b" d="M20 4v5h-5" />)],
  [/approval|policies/, svg(<path key="a" d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />, <path key="b" d="M9 12l2 2 4-4" />)],
  [/^\/stock$/, svg(<path key="a" d="M3 8l9-5 9 5v8l-9 5-9-5V8z" />, <path key="b" d="M3 8l9 5 9-5M12 13v8" />)],
  [/counts?$/, svg(<rect key="a" x="5" y="4" width="14" height="17" rx="2" />, <path key="b" d="M9 4h6v3H9z" />, <path key="c" d="M9 13l2 2 4-4" />)],
  [/adjustments/, svg(<path key="a" d="M5 6h14M5 12h14M5 18h14" />, <circle key="b" cx="9" cy="6" r="1.8" />, <circle key="c" cx="15" cy="12" r="1.8" />, <circle key="d" cx="8" cy="18" r="1.8" />)],
  [/suppliers|customers|users|people/, svg(<circle key="a" cx="9" cy="8" r="3.2" />, <path key="b" d="M3 20a6 6 0 0112 0" />, <path key="c" d="M16 5.5a3 3 0 010 5.8M21 20a5.5 5.5 0 00-3.5-5.1" />)],
  [/invoices/, svg(<path key="a" d="M6 3h9l4 4v14H6z" />, <path key="b" d="M15 3v4h4M9 12h7M9 16h5" />)],
  [/payments/, svg(<rect key="a" x="3" y="6" width="18" height="13" rx="2.5" />, <path key="b" d="M3 10h18M7 15h3" />)],
  [/overview/, svg(<path key="a" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />)],
  [/orders/, svg(<path key="a" d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />, <path key="b" d="M9 8h6M9 12h6" />)],
  [/whatsapp/, svg(<path key="a" d="M4 20l1.3-4A8 8 0 1112 20a8 8 0 01-3.8-1z" />)],
  [/outbox/, svg(<path key="a" d="M4 12l16-8-6 16-2.5-6.5z" />, <path key="b" d="M11.5 13.5L20 4" />)],
  [/audit/, svg(<circle key="a" cx="12" cy="12" r="9" />, <path key="b" d="M12 7v5l3 2" />)],
  [/apps/, svg(<rect key="a" x="4" y="4" width="6" height="6" rx="1.5" />, <rect key="b" x="14" y="4" width="6" height="6" rx="1.5" />, <rect key="c" x="4" y="14" width="6" height="6" rx="1.5" />, <rect key="d" x="14" y="14" width="6" height="6" rx="1.5" />)],
];
const DEFAULT_PAGE = svg(<path key="a" d="M4 6h16M4 12h16M4 18h10" />);

/**
 * The icon for one page of an app. `path` is the page path inside its app ('' for the app's first page); the first page uses the
 * app's own icon. Settings > General (path '') falls back to the settings gear.
 */
export function PageIcon({ appKey, path }: { appKey: string; path: string }) {
  if (path === '' || path === '/') {
    // An app's first page: Finance's is Expenses (a receipt); every other app's first page is shown with the app's own icon.
    if (appKey === 'finance') return svg(<path key="a" d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />, <path key="b" d="M9 8h6M9 12h6M9 16h3" />);
    return <AppIcon appKey={appKey} name="" />;
  }
  return <>{PAGE.find(([re]) => re.test(path))?.[1] ?? DEFAULT_PAGE}</>;
}
