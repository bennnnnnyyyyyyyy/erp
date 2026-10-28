import { createContext, useContext } from 'react';
import type { SessionInfo } from '@ggo/shared';

type SessionValue = { session: SessionInfo; reload: () => void };

export const SessionContext = createContext<SessionValue | null>(null);

function useSessionValue(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a signed-in organization');
  return value;
}

export function useSession(): SessionInfo {
  return useSessionValue().session;
}

/** Re-fetches /v1/core/session, for example after the org's name or time zone changes. */
export function useReloadSession(): () => void {
  return useSessionValue().reload;
}
