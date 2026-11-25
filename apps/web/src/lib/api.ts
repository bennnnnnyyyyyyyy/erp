import type { ApiResponse } from '@erp/shared';
import { demoApi, demoMode } from './demo';
import { currentLanguage, tr, trf } from './i18n';
import { NEXT_STEP_EVENT, nextStepFor } from './nextStep';
import { supabase } from './supabase';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const ORG_KEY = 'erp.activeOrgId';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function getActiveOrgId(): string | null {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function setActiveOrgId(orgId: string | null) {
  try {
    if (orgId) localStorage.setItem(ORG_KEY, orgId);
    else localStorage.removeItem(ORG_KEY);
  } catch {
    // Storage blocked: the org choice just won't survive a reload.
  }
}

/** Downloads a file the API sends (for example a CSV export), with the same sign-in and organization headers as `api`. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers();
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  const orgId = getActiveOrgId();
  if (orgId) headers.set('X-Org-Id', orgId);
  const res = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(res.status, body?.error ?? 'Download failed', body?.code);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (demoMode) return demoApi<T>(path, init);
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  const orgId = getActiveOrgId();
  if (orgId) headers.set('X-Org-Id', orgId);
  // a file upload sets its own multipart type; everything else is JSON
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  // A request that hangs ends after 30 s with a plain message (input and speed audit, 25 Nov 2026: "Saving…" stayed for minutes).
  const timeout = AbortSignal.timeout(30_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    if (timeout.aborted) throw new ApiError(0, tr('The server is taking too long. Try again in a moment.'), 'timeout');
    // The browser's own "Failed to fetch" means nothing to a person (UX audit).
    throw new ApiError(0, tr('Cannot reach the server. Check your internet connection and try again.'), 'offline');
  }
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  // Not JSON: a gateway page (502, 503, 504, Cloudflare 524 after about 100 s). Say it was busy or slow, not "unreadable".
  if (!body) {
    if (res.status >= 500) throw new ApiError(res.status, tr('The server is busy or took too long. Try again in a moment.'), 'server_busy');
    throw new ApiError(res.status, tr('The server sent an unreadable response'));
  }
  if (!body.success) throw new ApiError(body.status, withNextStep(translateServerError(body.error), body.code), body.code);
  return body.data;
}

/**
 * A blocked action says what unblocks it (lib/nextStep.ts, one table for every error): the sentence is added to the message every
 * screen shows, and a page that fixes it is offered once in the Shell's bar (components/NextStepBar.tsx).
 */
export function withNextStep(message: string, code?: string): string {
  const next = nextStepFor(code);
  if (!next) return message;
  if (next.to && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NEXT_STEP_EVENT, { detail: next }));
  return `${message.replace(/\.$/, '')}. ${tr(next.text)}`;
}

/**
 * Server messages are English sentences (apps/api/src/lib/rpc.ts), sometimes followed by ": " and details. The sentence is translated
 * here, once, for every screen (UX audit: every Arabic user saw errors in English); the details (numbers, names) are kept as sent.
 */
export function translateServerError(message: string): string {
  const whole = tr(message);
  if (whole !== message) return whole;
  // The plain stock-shortage sentence the server builds (apps/api/src/lib/rpc.ts); its numbers are placed into the Arabic sentence.
  const short = /^Not enough stock: you asked for (\S+), but only (\S+) (?:is|are) available in this warehouse\.$/.exec(message);
  if (short && currentLanguage() === 'ar') {
    return trf('Not enough stock: you asked for {asked}, but only {available} available in this warehouse.', { asked: short[1] as string, available: short[2] as string });
  }
  // The API's input checks (input audit, 25 Nov 2026): "Line 2: choose an item", "Contact: at most 120 characters". Both parts translate.
  const line = /^Line (\d+): (.+)$/.exec(message);
  if (line) return `${trf('Line {n}', { n: line[1] as string })}: ${tr(line[2] as string)}`;
  const most = /^(.+): at most (\d+) characters$/.exec(message);
  if (most) return trf('{field}: at most {n} characters', { field: tr(most[1] as string), n: most[2] as string });
  const cut = message.indexOf(': ');
  if (cut < 0) return message;
  const head = message.slice(0, cut);
  const tail = message.slice(cut + 2);
  const translated = tr(head);
  const tailTranslated = tr(tail);
  return translated === head && tailTranslated === tail ? message : `${translated}: ${tailTranslated}`;
}
