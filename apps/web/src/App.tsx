import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { SessionInfo } from '@ggo/shared';
import { api, getActiveOrgId, setActiveOrgId } from './lib/api';
import { arrivedFromInvite, arrivedToSetPassword, supabase } from './lib/supabase';
import { SessionContext } from './session';
import { SignIn } from './components/SignIn';
import { SetPassword } from './components/SetPassword';
import { OrgPicker } from './components/OrgPicker';
import { Shell } from './components/Shell';

export function App() {
  const [auth, setAuth] = useState<Session | null | undefined>(undefined);
  const [orgId, setOrgId] = useState<string | null>(getActiveOrgId());
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionTick, setSessionTick] = useState(0);
  const [recovering, setRecovering] = useState(arrivedToSetPassword);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuth(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setAuth(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setSession(null);
    if (!auth || !orgId) return;
    api<SessionInfo>('/v1/core/session')
      .then(setSession)
      .catch((e: Error) => {
        setError(e.message);
        chooseOrg(null);
      });
  }, [auth, orgId, sessionTick]);

  function chooseOrg(id: string | null) {
    if (id) setError(null);
    setActiveOrgId(id);
    setOrgId(id);
  }

  if (auth === undefined) return null;
  if (!auth) return <SignIn />;
  if (recovering) return <SetPassword invited={arrivedFromInvite} onDone={() => setRecovering(false)} />;
  if (!orgId) {
    return (
      <>
        {error && <p className="error banner">{error}</p>}
        <OrgPicker onPick={chooseOrg} />
      </>
    );
  }
  if (!session) return <main className="center"><p className="muted">Loading…</p></main>;

  return (
    <SessionContext.Provider value={{ session, reload: () => setSessionTick((t) => t + 1) }}>
      <Shell
        onSwitchOrg={() => chooseOrg(null)}
        onSignOut={() => {
          chooseOrg(null);
          supabase.auth.signOut();
        }}
      />
    </SessionContext.Provider>
  );
}
