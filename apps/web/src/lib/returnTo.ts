// Deep links through sign-in (Ben's phone test, 24 Nov 2026): an invoice's QR code, a bell or WhatsApp/email link opens a page of the
// app. Signed out, the sign-in screen shows at that same address, so a password sign-in already lands there. Google sign-in and the
// emailed links come back to the site's home address instead, so the page asked for is kept here and opened after sign-in.

const KEY = 'erp.returnTo';
const MAX_AGE_MS = 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Only a page of this app: one leading slash (not "//host"), no backslash, not the public invoice page (it needs no sign-in). */
export function isSafeReturnPath(p: string): boolean {
  return /^\/(?!\/)/.test(p) && !p.includes('\\') && !/^\/i\//.test(p) && p.length <= 500;
}

/** Keeps the page being opened while signed out (nothing for the home page). */
export function rememberReturnPath(path: string, store: Store = localStorage, now = Date.now()): void {
  try {
    if (path === '/' || !isSafeReturnPath(path)) return;
    store.setItem(KEY, JSON.stringify({ path, at: now }));
  } catch {
    /* storage blocked: the sign-in still works, it lands on home */
  }
}

/**
 * After sign-in: the page to open, or null. Only when the app came back to the home page (else the person is already where they
 * asked to be), and only within an hour. The kept page is forgotten either way.
 */
export function takeReturnPath(current: string, store: Store = localStorage, now = Date.now()): string | null {
  try {
    const raw = store.getItem(KEY);
    store.removeItem(KEY);
    if (!raw || current !== '/') return null;
    const v = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof v.path !== 'string' || typeof v.at !== 'number' || now - v.at > MAX_AGE_MS || !isSafeReturnPath(v.path)) return null;
    return v.path;
  } catch {
    return null;
  }
}
