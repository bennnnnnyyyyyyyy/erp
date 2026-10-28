import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { NotConfiguredError } from './errors';

// ADR-0003: request routes talk to Postgres as the signed-in user (publishable key plus the caller's
// own JWT), so row level security and the database functions see who is asking. The active
// organization travels in `X-Org-Id`; the database accepts it only after checking membership.
export function userDb(c: Context<AppEnv>): SupabaseClient {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = c.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new NotConfiguredError('Supabase');
  const headers: Record<string, string> = { Authorization: c.req.header('Authorization') ?? '' };
  const org = c.req.header('X-Org-Id');
  if (org) headers['X-Org-Id'] = org;
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}
