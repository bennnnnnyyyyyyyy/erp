// One plain status per integration, from its switch, its mode and its last call (Settings > Integrations). Pure, so it can be tested.

export type ConnectionStatus = 'off' | 'test' | 'live' | 'problem';

export type Connection = { key: string; name: string; enabled: boolean; mode: 'simulated' | 'live'; lastStatus: 'sent' | 'failed' | null };

export function connectionStatus(c: Pick<Connection, 'enabled' | 'mode' | 'lastStatus'>): ConnectionStatus {
  if (!c.enabled) return 'off';
  if (c.lastStatus === 'failed') return 'problem';
  return c.mode === 'live' ? 'live' : 'test';
}

export function countStatuses(connections: Connection[]): Record<ConnectionStatus, number> {
  const counts: Record<ConnectionStatus, number> = { live: 0, test: 0, problem: 0, off: 0 };
  for (const c of connections) counts[connectionStatus(c)]++;
  return counts;
}

/** What the owner should look at: problems first, then anything switched on but still in test mode. */
export function needsAttention(connections: Connection[]): { connection: Connection; status: 'problem' | 'test' }[] {
  const of = (s: 'problem' | 'test') => connections.filter((c) => connectionStatus(c) === s).map((connection) => ({ connection, status: s }));
  return [...of('problem'), ...of('test')];
}

export const STATUS_LABEL: Record<ConnectionStatus, string> = { off: 'Off', test: 'Test mode', live: 'Live', problem: 'Problem' };
export const STATUS_PILL: Record<ConnectionStatus, string> = { off: 'st-cancelled', test: 'st-pending', live: 'st-sent', problem: 'st-failed' };
