import { describe, expect, it } from 'vitest';
import { recordDelivery, type CompletionDeps } from '../src/jobs/outbox';

// Repo audit 2026-11-06, N1: recording a delivery result is retried, an ambiguous INVALID_STATE is checked against the row, and a
// result that still cannot be recorded is returned (the pass then stops sending) instead of thrown.

function deps(results: (string | null)[], status: string | null = 'sending') {
  let calls = 0;
  const waits: number[] = [];
  const d: CompletionDeps = {
    complete: async () => {
      const e = results[Math.min(calls, results.length - 1)];
      calls++;
      return { error: e ? { message: e } : null };
    },
    status: async () => status,
    wait: async (ms) => {
      waits.push(ms);
    },
  };
  return { d, calls: () => calls, waits };
}

describe('recordDelivery', () => {
  it('records on the first try', async () => {
    const t = deps([null]);
    expect(await recordDelivery(t.d)).toBeNull();
    expect(t.calls()).toBe(1);
  });

  it('retries a failed write and succeeds', async () => {
    const t = deps(['connection reset', null]);
    expect(await recordDelivery(t.d)).toBeNull();
    expect(t.calls()).toBe(2);
    expect(t.waits).toEqual([250]);
  });

  it('treats INVALID_STATE as already recorded when the row has left sending', async () => {
    const t = deps(['timeout', 'INVALID_STATE: message is sent'], 'sent');
    expect(await recordDelivery(t.d)).toBeNull();
    expect(t.calls()).toBe(2);
  });

  it('does not treat INVALID_STATE as recorded while the row is still sending', async () => {
    const t = deps(['INVALID_STATE'], 'sending');
    expect(await recordDelivery(t.d)).toMatch(/INVALID_STATE/);
    expect(t.calls()).toBe(3);
  });

  it('returns the error after the last attempt instead of throwing', async () => {
    const t = deps(['database unreachable']);
    expect(await recordDelivery(t.d)).toBe('database unreachable');
    expect(t.calls()).toBe(3);
  });
});
