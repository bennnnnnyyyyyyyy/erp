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
