import { useEffect, useState } from 'react';
import { Loading } from './components/Loading';
import type { Session } from '@supabase/supabase-js';
import type { SessionInfo } from '@erp/shared';
import { api, getActiveOrgId, setActiveOrgId } from './lib/api';
import { arrivedFromInvite, arrivedToSetPassword, supabase } from './lib/supabase';
import { SessionContext } from './session';
import { setCompanyTimeZone } from './lib/dates';
import { reloadMode, sessionKey } from './lib/sessionKey';
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

  // Reload the session only when the signed-in person or the company changes, or a screen asks (sessionTick); never on a token
  // renewal or the tab regaining focus, which are new `auth` objects for the same person (see lib/sessionKey.ts).
  const loadKey = sessionKey(auth?.user.id, orgId);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    const mode = reloadMode(loadedFor, loadKey);
    if (mode !== 'refresh') setSession(null);
    if (mode === 'none') return;
    api<SessionInfo>('/v1/core/session')
      .then((s) => {
        setSession(s);
        setLoadedFor(loadKey);
      })
      .catch((e: Error) => {
        setError(e.message);
        chooseOrg(null);
      });
    // loadedFor is read here, not a reason to reload: leaving it out of the dependencies is deliberate.
  }, [loadKey, sessionTick]);

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
  // Default dates on every form follow the company's time zone (lib/dates.ts, decision D11).
  setCompanyTimeZone(session.org?.timezone);

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
