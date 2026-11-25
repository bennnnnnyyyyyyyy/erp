import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

// A minimal history-API router: the app only needs "which path am I on" and "go to a path".

const EVENT = 'erp:navigate';

/** How many pages of this app lie behind the current one in this tab (0: it was opened from outside, a link, a QR code or a reload). */
export function appDepth(state: unknown = window.history.state): number {
  const d = (state as { erpDepth?: unknown } | null)?.erpDepth;
  return typeof d === 'number' && d > 0 ? d : 0;
}

export function navigate(path: string) {
  if (path === window.location.pathname + window.location.search) return;
  window.history.pushState({ erpDepth: appDepth() + 1 }, '', path);
  window.dispatchEvent(new Event(EVENT));
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return path;
}

/** Values of `:name` segments in the current page's path. */
export const ParamsContext = createContext<Record<string, string>>({});

export function useParam(name: string): string {
  return useContext(ParamsContext)[name] ?? '';
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    // Let the browser handle new-tab clicks.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={handle} {...rest} />;
}

/**
 * "← Back" (dead-ends audit, 25 Nov 2026): returns to the page the person came from in this app (an invoice, the bell, a report), as
 * the browser's back button does. Opened from outside (a QR code, an email or WhatsApp link, a reload), there is nothing to return to,
 * so it opens `to`, the list the page belongs to, and says so: "← Sales orders".
 */
export function BackLink({ to, label, backLabel }: { to: string; label: string; backLabel: string }) {
  const canGoBack = appDepth() > 0;
  return (
    <a
      href={to}
      className="back-link"
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (canGoBack) window.history.back();
        else navigate(to);
      }}
    >
      {canGoBack ? backLabel : label}
    </a>
  );
}
