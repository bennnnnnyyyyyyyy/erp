import { useCallback, useMemo } from 'react';
import { api } from './api';
import { demoMode } from './demo';
import { ACTOR_NAMES } from './demoInventory';
import { useLoad } from './useLoad';

type Person = { userId: string; name: string };

/** Turns a user id into a name for display: the members list in the real app, fixed names in the demo. */
export function usePeople(): (id: string | null) => string {
  const people = useLoad(() => (demoMode ? Promise.resolve([] as Person[]) : api<Person[]>('/v1/core/people')));
  const names = useMemo(() => new Map((people.data ?? []).map((p) => [p.userId, p.name])), [people.data]);
  return useCallback(
    (id: string | null) => {
      if (!id) return 'System';
      if (demoMode) return ACTOR_NAMES[id] ?? id;
      return names.get(id) ?? 'Someone';
    },
    [names],
  );
}
