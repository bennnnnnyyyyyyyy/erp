import { useEffect, useState } from 'react';
import { Loading } from './components/Loading';
import type { Session } from '@supabase/supabase-js';
import type { SessionInfo } from '@erp/shared';
import { api, getActiveOrgId, setActiveOrgId } from './lib/api';
import { arrivedFromInvite, arrivedToSetPassword, supabase } from './lib/supabase';
import { SessionContext } from './session';
import { SignIn } from './components/SignIn';
import {useI18n, tr } from './lib/i18n';
import { SetPassword } from './components/SetPassword';
import { OrgPicker } from './components/OrgPicker';
import { Shell } from './components/Shell';

export function App() {
  const { lang } = useI18n();
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

  // Reload the session only when WHO is signed in or WHICH company changes, or a screen asks for it (sessionTick). Supabase also fires
  // auth events when it renews the token and when the tab regains focus; each one is a new `auth` object for the same person. Keying
  // this on `auth` itself blanked the whole app and reloaded every list on each of those events (the "refresh every few seconds").
  const authUserId = auth?.user.id ?? null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!authUserId || !orgId) { setSession(null); return; }
    const key = `${authUserId}:${orgId}`;
    // Same person and company: refresh in place (no blank screen). Someone else or another company: clear first.
    if (loadedFor !== key) setSession(null);
    api<SessionInfo>('/v1/core/session')
      .then((s) => { setSession(s); setLoadedFor(key); })
      .catch((e: Error) => {
        setError(e.message);
        chooseOrg(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadedFor is read, not a trigger
  }, [authUserId, orgId, sessionTick]);

  function chooseOrg(id: string | null) {
    if (id) setError(null);
    setActiveOrgId(id);
    setOrgId(id);
  }

  if (auth === undefined) return null;
  if (!auth) return <SignIn key={lang} />;
  if (recovering) return <SetPassword key={lang} invited={arrivedFromInvite} onDone={() => setRecovering(false)} />;
  if (!orgId) {
    return (
      <>
        {error && <p className="error banner">{error}</p>}
        <OrgPicker key={lang} onPick={chooseOrg} />
      </>
    );
  }
  if (!session) return <main className="center"><Loading /></main>;

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
