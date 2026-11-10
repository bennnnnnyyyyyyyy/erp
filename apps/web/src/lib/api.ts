import type { ApiResponse } from '@erp/shared';
import { demoApi, demoMode } from './demo';
import { currentLanguage, tr, trf } from './i18n';
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

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    // The browser's own "Failed to fetch" means nothing to a person (UX audit).
    throw new ApiError(0, tr('Cannot reach the server. Check your internet connection and try again.'), 'offline');
  }
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) throw new ApiError(res.status, tr('The server sent an unreadable response'));
  if (!body.success) throw new ApiError(body.status, translateServerError(body.error), body.code);
  return body.data;
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
  const cut = message.indexOf(': ');
  if (cut < 0) return message;
  const head = message.slice(0, cut);
  const translated = tr(head);
  return translated === head ? message : `${translated}: ${message.slice(cut + 2)}`;
}
