import { createClient } from '@supabase/supabase-js';

// The browser uses Supabase only for sign-in and the organization picker. All other data goes
// through the API, which enforces tenancy and permissions. Values come from the root .env
// (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) via apps/web/vite.config.ts.
export const googleSignInEnabled = import.meta.env.VITE_AUTH_GOOGLE_ENABLED === 'true';

export const supabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

// Read before createClient, which strips the tokens from the URL. A password-reset email link
// (`type=recovery`) or an invite link (`type=invite`) lands here with tokens in the hash, or with
// `error_description` if it has expired. Both mean "set a password now".
const hash = new URLSearchParams(window.location.hash.slice(1));
export const arrivedToSetPassword = hash.get('type') === 'recovery' || hash.get('type') === 'invite';
export const arrivedFromInvite = hash.get('type') === 'invite';
export const authLinkError = hash.get('error_description');

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'missing-publishable-key',
);
