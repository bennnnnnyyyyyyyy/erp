import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from '../env';
import { fail } from '../lib/response';

// Repo audit 2026-11-06, finding 8: a body cap enforced before the handler reads the body, so an oversized request is refused without
// being held in memory first. Hono's middleware compares Content-Length when it is declared and counts the streamed bytes otherwise.
// The handlers keep their own length checks as a second line. Limits differ by route on purpose (webhooks, Shopify orders, audio).
export const KB = 1024;
export const MB = 1024 * KB;

export function limitBody(maxBytes: number) {
  return bodyLimit({ maxSize: maxBytes, onError: (c) => fail(c as Context<AppEnv>, 413, 'Too large', 'too_large') });
}
