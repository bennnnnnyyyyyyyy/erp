import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Bindings } from '../env';
import { NotConfiguredError } from './errors';

// ADR-0003: the secret key bypasses row level security. Use it only where there is no signed-in
// user's database path: Supabase Auth admin calls (invites), provisioning, webhook ingestion and
// scheduled jobs. Request routes use `userDb` instead.
// apps/api/test/boundaries.test.ts fails the build if a file outside its allowlist imports this.
export function adminDb(env: Bindings): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new NotConfiguredError('Supabase');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
