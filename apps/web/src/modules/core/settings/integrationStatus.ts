// One plain status per integration, from its switch and its last real call (Settings > Integrations). Pure, so it can be tested.
// sql/082: there is no test mode. On means real, so the question is only whether the last real call (a delivery, a payment link, or
// "Check connection") worked:
//   off        switched off
//   unchecked  on, but nothing has been sent or checked yet
//   working    on, and the last real call worked
//   problem    on, and the last real call failed

export type ConnectionStatus = 'off' | 'unchecked' | 'working' | 'problem';

export type Connection = { key: string; name: string; enabled: boolean; lastStatus: 'sent' | 'failed' | null };

export function connectionStatus(c: Pick<Connection, 'enabled' | 'lastStatus'>): ConnectionStatus {
  if (!c.enabled) return 'off';
  if (c.lastStatus === 'failed') return 'problem';
  return c.lastStatus === 'sent' ? 'working' : 'unchecked';
}

export function countStatuses(connections: Connection[]): Record<ConnectionStatus, number> {
  const counts: Record<ConnectionStatus, number> = { working: 0, unchecked: 0, problem: 0, off: 0 };
  for (const c of connections) counts[connectionStatus(c)]++;
  return counts;
}

/** What the owner should look at: problems first, then anything switched on that has never been shown to work. */
export function needsAttention(connections: Connection[]): { connection: Connection; status: 'problem' | 'unchecked' }[] {
  const of = (s: 'problem' | 'unchecked') => connections.filter((c) => connectionStatus(c) === s).map((connection) => ({ connection, status: s }));
  return [...of('problem'), ...of('unchecked')];
}

export const STATUS_LABEL: Record<ConnectionStatus, string> = { off: 'Off', unchecked: 'On, not checked', working: 'Working', problem: 'Problem' };
export const STATUS_PILL: Record<ConnectionStatus, string> = { off: 'st-cancelled', unchecked: 'st-pending', working: 'st-sent', problem: 'st-failed' };
