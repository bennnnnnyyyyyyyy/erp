import { describe, expect, it } from 'vitest';
import { mayDecide } from './approvals';

describe('mayDecide', () => {
  it("lets a manager decide someone else's request", () => {
    expect(mayDecide({ userId: 'me', mayApproveOwn: false }, 'other')).toBe(true);
  });
  it('hides Approve on your own request when the company has another owner or admin (UX audit: own credit note)', () => {
    expect(mayDecide({ userId: 'me', mayApproveOwn: false }, 'me')).toBe(false);
  });
  it('keeps it for the only owner or admin, or an owner when owners may approve their own', () => {
    expect(mayDecide({ userId: 'me', mayApproveOwn: true }, 'me')).toBe(true);
  });
  it('keeps the old behaviour when the API does not say', () => {
    expect(mayDecide({ userId: 'me' }, 'me')).toBe(true);
  });
});
