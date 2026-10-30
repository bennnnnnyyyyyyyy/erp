import type { Bindings } from '../env';
import { adminDb } from './db.admin';
import { HttpError } from './errors';

// Supabase Auth admin calls (creating accounts and sign-in links). These need the secret key and touch only Auth, never
// business rows: who may do what, and the audit, are checked by the database functions the routes call first (sql/025).

/** Creates the account for a new email, tags it with the inviting organization, and returns its id and one-time link. */
export async function createInvitedAccount(env: Bindings, email: string, orgId: string, redirectTo: string): Promise<{ userId: string; link: string }> {
  const client = adminDb(env);
  const { data, error } = await client.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } });
  if (error) throw new HttpError(502, `Couldn't create the invite: ${error.message}`, 'invite_failed');
  // Records which org created the account, so only that org may add it directly or issue it a new link later.
  const { error: metaErr } = await client.auth.admin.updateUserById(data.user.id, { app_metadata: { invited_org_id: orgId } });
  if (metaErr) throw metaErr;
  return { userId: data.user.id, link: data.properties.action_link };
}

/** A fresh one-time sign-in link for an invited account that has not signed in yet. */
export async function recoveryLink(env: Bindings, email: string, redirectTo: string): Promise<string> {
  const { data, error } = await adminDb(env).auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
  if (error) throw new HttpError(502, `Couldn't create the link: ${error.message}`, 'invite_failed');
  return data.properties.action_link;
}
