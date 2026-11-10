import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Bindings } from '../env';
import { NotConfiguredError } from './errors';

// For routes with no signed-in user whose only credential is a secret in the address (private report links, sql/070). It uses the
// publishable key, so the database treats the caller as `anon` and only functions granted to anon can run. Never the secret key.
export function anonDb(env: Bindings): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new NotConfiguredError('Supabase');
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
