import type { AuditEntry } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { collapseSame } from '../lib/auditText';

const row = (id: number, at: string, actor: string | null = null): AuditEntry =>
  ({ id, occurred_at: at, action: 'messaging.reminder.queued', summary: 'Reminder queued for OUT-0376', actor_user_id: actor, entity_type: 'stock_request', entity_id: 'r1' }) as unknown as AuditEntry;

describe('collapseSame', () => {
  it('shows a reminder queued for two managers at once as one row with a count (OUT-0376, UX audit)', () => {
    const out = collapseSame([row(1, '2026-11-19T14:15:17Z'), row(2, '2026-11-19T14:15:17Z')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.times).toBe(2);
  });

  it('keeps rows apart when the time or the person differs', () => {
    expect(collapseSame([row(1, '2026-11-19T14:15:17Z'), row(2, '2026-11-19T14:45:17Z')])).toHaveLength(2);
    expect(collapseSame([row(1, '2026-11-19T14:15:17Z', 'a'), row(2, '2026-11-19T14:15:17Z', 'b')])).toHaveLength(2);
  });
});
