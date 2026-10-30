import { useCallback, useEffect, useState } from 'react';
import type { MyInvitation } from '@erp/shared';
import { supabase } from '../lib/supabase';

type OrgOption = { id: string; name: string };
type InvitationRow = { id: string; org_id: string; org_name: string; role: MyInvitation['role']; invited_by_name: string | null; created_at: string };

// Lists the organizations the signed-in user belongs to, and invitations waiting for them. Reads through Supabase
// directly: RLS limits memberships to the user's own (sql/001), and core_my_invitations returns only their own (sql/025).
// Someone who already had an account joins another organization only by accepting here.
export function OrgPicker({ onPick }: { onPick: (orgId: string) => void }) {
  const [orgs, setOrgs] = useState<OrgOption[] | null>(null);
  const [invitations, setInvitations] = useState<MyInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (autoOpen: boolean) => {
    const [orgRes, invRes] = await Promise.all([
      supabase.from('memberships').select('organizations(id, name)').is('disabled_at', null),
      supabase.rpc('core_my_invitations'),
    ]);
    if (orgRes.error) return setError(orgRes.error.message);
    // An invitations error (for example the migration not run yet) must not lock people out of their organizations.
    const pending = invRes.error
      ? []
      : ((invRes.data ?? []) as InvitationRow[]).map((r) => ({
          id: r.id, orgId: r.org_id, orgName: r.org_name, role: r.role, invitedByName: r.invited_by_name, createdAt: r.created_at,
        }));
    const rows = (orgRes.data ?? []) as unknown as { organizations: OrgOption | null }[];
    const list = rows.flatMap((r) => (r.organizations ? [r.organizations] : []));
    // Most people belong to one organization: open it instead of asking, unless an invitation is waiting.
    if (autoOpen && list.length === 1 && list[0] && pending.length === 0) return onPick(list[0].id);
    setInvitations(pending);
    setOrgs(list);
  }, [onPick]);

  useEffect(() => {
    void load(true);
    // Runs once on mount; `onPick` is stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function respond(inv: MyInvitation, accept: boolean) {
    setBusyId(inv.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('core_respond_invitation', { p_invitation_id: inv.id, p_accept: accept });
    setBusyId(null);
    if (rpcError) return setError(rpcError.message);
    await load(false);
  }

  if (!orgs && error) return <main className="center"><p className="error">{error}</p></main>;
  if (!orgs) return <main className="center"><p className="muted">Loading organizations…</p></main>;

  return (
    <main className="center">
      <div className="card stack">
        {invitations.length > 0 && (
          <>
            <h1>Invitations</h1>
            {invitations.map((inv) => (
              <div key={inv.id} className="stack">
                <p>
                  {inv.invitedByName ?? 'Someone'} invited you to join <strong>{inv.orgName}</strong> as {inv.role}.
                </p>
                <div className="form-actions">
                  <button disabled={busyId === inv.id} onClick={() => respond(inv, true)}>
                    Accept
                  </button>
                  <button className="secondary" disabled={busyId === inv.id} onClick={() => respond(inv, false)}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
        <h1>Choose an organization</h1>
        {error && <p className="error">{error}</p>}
        {orgs.length === 0 && <p className="muted">You aren't a member of any organization yet. Ask an admin to invite you.</p>}
        {orgs.map((o) => (
          <button key={o.id} onClick={() => onPick(o.id)}>
            {o.name}
          </button>
        ))}
        <button className="secondary" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}
