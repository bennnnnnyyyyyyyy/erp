import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type OrgOption = { id: string; name: string };

// Lists the organizations the signed-in user belongs to. Reads through Supabase directly,
// which RLS limits to the user's own memberships (see sql/001).
export function OrgPicker({ onPick }: { onPick: (orgId: string) => void }) {
  const [orgs, setOrgs] = useState<OrgOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('memberships')
      .select('organizations(id, name)')
      .is('disabled_at', null)
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        const rows = (data ?? []) as unknown as { organizations: OrgOption | null }[];
        const list = rows.flatMap((r) => (r.organizations ? [r.organizations] : []));
        // Most people belong to one organization: open it instead of asking.
        if (list.length === 1 && list[0]) onPick(list[0].id);
        else setOrgs(list);
      });
    // Runs once on mount; `onPick` is stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <main className="center"><p className="error">{error}</p></main>;
  if (!orgs) return <main className="center"><p className="muted">Loading organizations…</p></main>;

  return (
    <main className="center">
      <div className="card stack">
        <h1>Choose an organization</h1>
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
