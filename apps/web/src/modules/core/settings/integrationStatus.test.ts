import { describe, expect, it } from 'vitest';
import { connectionStatus, countStatuses, needsAttention, type Connection } from './integrationStatus';

const c = (key: string, enabled: boolean, mode: Connection['mode'], lastStatus: Connection['lastStatus'] = null): Connection => ({ key, name: key, enabled, mode, lastStatus });

describe('connectionStatus', () => {
  it('is off when switched off, whatever else is true', () => {
    expect(connectionStatus(c('a', false, 'live', 'failed'))).toBe('off');
  });
  it('is a problem when on and the last call failed, in either mode', () => {
    expect(connectionStatus(c('a', true, 'live', 'failed'))).toBe('problem');
    expect(connectionStatus(c('a', true, 'simulated', 'failed'))).toBe('problem');
  });
  it('is live or test by mode', () => {
    expect(connectionStatus(c('a', true, 'live', 'sent'))).toBe('live');
    expect(connectionStatus(c('a', true, 'simulated'))).toBe('test');
  });
});

describe('summary', () => {
  const all = [c('off', false, 'simulated'), c('test', true, 'simulated'), c('live', true, 'live'), c('bad', true, 'live', 'failed')];
  it('counts each status', () => {
    expect(countStatuses(all)).toEqual({ live: 1, test: 1, problem: 1, off: 1 });
  });
  it('lists problems first, then test mode, and never live or off', () => {
    expect(needsAttention(all).map((a) => a.connection.key)).toEqual(['bad', 'test']);
  });
});
