import type { Context } from 'hono';
import { HttpError } from './errors';

/** Reads a JSON object body, or fails with 400. Field checks are up to the route. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Send a JSON object', 'invalid_body');
  }
  return body as Record<string, unknown>;
}

export function invalid(message: string): never {
  throw new HttpError(400, message, 'invalid_input');
}

// ---- Shared input checks (input and speed audit, 25 Nov 2026: a tester of another product found months like 14, 6-digit years,
// 40-digit phones and any text as email accepted; the screen is not the guard, the API and the database are).

/** A real calendar day "YYYY-MM-DD", years 1900 to 2100. "2026-02-30" used to pass the shape check and fail in the database (a 500). */
export function isIsoDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** Stands in for the old `/^\d{4}-\d{2}-\d{2}$/` in the routes (`DATE_RE.test(x)`), with the calendar and year checks above. */
export const ISO_DAY = { test: (v: unknown): boolean => isIsoDay(v) };

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toWesternDigits = (s: string) => s.replace(ARABIC_DIGITS, (ch) => String((ch.charCodeAt(0) & 0xf) % 10));

/**
 * A phone number as people type it (spaces, dashes, brackets, a leading +, Arabic digits): 7 to 15 digits (the international maximum).
 * Returns the trimmed text as typed (Western digits), null when empty; refuses anything else with a plain 400.
 */
export function phoneOrNull(v: unknown, label = 'Phone'): string | null {
  const raw = typeof v === 'string' ? toWesternDigits(v).trim() : typeof v === 'number' ? String(v) : '';
  if (!raw) return null;
  const digits = raw.replace(/[\s\-().]/g, '');
  if (!/^\+?\d{7,15}$/.test(digits)) invalid(`${label}: 7 to 15 digits (spaces, dashes and a leading + are fine)`);
  return raw;
}

/** Trimmed text of at most `max` characters, null when empty; longer text is refused, never cut. */
export function textUpTo(v: unknown, max: number, label: string): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) return null;
  if (t.length > max) invalid(`${label}: at most ${max} characters`);
  return t;
}

/** The largest amount in minor units the API accepts (10 billion in a two-decimal currency), well inside exact JS and bigint sums. */
export const MAX_MINOR = 1_000_000_000_000;
/** The largest quantity (one line, one movement). */
export const MAX_QTY = 1_000_000_000;
/** A quantity: finite, above 0, at most 3 decimals and MAX_QTY. */
export const isGoodQty = (n: number): boolean =>
  Number.isFinite(n) && n > 0 && n <= MAX_QTY && Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6;

/** A customer's or supplier's name (required, at most 200), contact (120), city (80) and phone (7 to 15 digits). */
export function partyBasics(
  b: Record<string, unknown>,
  nameLabel: string,
): { name: string; contact: string | null; city: string | null; phone: string | null } {
  const name = textUpTo(b.name, 200, nameLabel);
  if (!name) invalid(`${nameLabel} is required`);
  return { name, contact: textUpTo(b.contact, 120, 'Contact'), city: textUpTo(b.city, 80, 'City'), phone: phoneOrNull(b.phone) };
}
