import { useCallback, useMemo } from 'react';
import type { Member } from '@erp/shared';
import { api } from './api';
import { demoMode } from './demo';
import { ACTOR_NAMES } from './demoInventory';
import { useLoad } from './useLoad';

/** Turns a user id into a name for display: the members list in the real app, fixed names in the demo. */
export function usePeople(): (id: string | null) => string {
  const members = useLoad(() => (demoMode ? Promise.resolve([] as Member[]) : api<Member[]>('/v1/core/members')));
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.userId, m.name ?? m.email])), [members.data]);
  return useCallback(
    (id: string | null) => {
      if (!id) return 'System';
      if (demoMode) return ACTOR_NAMES[id] ?? id;
      return names.get(id) ?? 'Someone';
    },
    [names],
  );
}
