import { describe, expect, it } from 'vitest';
import { connectionStatus, countStatuses, needsAttention, STATUS_LABEL, type Connection } from './integrationStatus';

const c = (key: string, enabled: boolean, lastStatus: Connection['lastStatus'] = null): Connection => ({ key, name: key, enabled, lastStatus });

describe('connectionStatus (sql/082: no test mode)', () => {
  it('is off when switched off, whatever else is true', () => {
    expect(connectionStatus(c('a', false, 'failed'))).toBe('off');
    expect(connectionStatus(c('a', false, 'sent'))).toBe('off');
  });
  it('is a problem when on and the last real call failed', () => {
    expect(connectionStatus(c('a', true, 'failed'))).toBe('problem');
  });
  it('is working only after a real call worked; on but never used or checked is "unchecked"', () => {
    expect(connectionStatus(c('a', true, 'sent'))).toBe('working');
    expect(connectionStatus(c('a', true))).toBe('unchecked');
  });
  it('no label mentions test mode', () => {
    expect(Object.values(STATUS_LABEL).join(' ')).not.toMatch(/test|simulat/i);
  });
});

describe('summary', () => {
  const all = [c('off', false), c('new', true), c('ok', true, 'sent'), c('bad', true, 'failed')];
  it('counts each status', () => {
    expect(countStatuses(all)).toEqual({ working: 1, unchecked: 1, problem: 1, off: 1 });
  });
  it('lists problems first, then anything on but unchecked, and never working or off', () => {
    expect(needsAttention(all).map((a) => a.connection.key)).toEqual(['bad', 'new']);
  });
});
