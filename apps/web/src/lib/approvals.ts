import type { SessionInfo } from '@erp/shared';

// Who may approve what they asked for themselves (decisions D1, D1b, D1c; sql/063, 065, 077). The database decides and refuses the
// rest; screens use this only to hide an Approve or Reject button that would be refused (UX audit 20 Nov: Approve showed on one's own
// credit note). The session says mayApproveOwn (GET /v1/core/session); an older API without it keeps the buttons, as before.

/** True when the signed-in person may decide this request: someone else asked for it, or they may approve their own. */
export function mayDecide(session: Pick<SessionInfo, 'userId' | 'mayApproveOwn'>, requesterId: string | null | undefined): boolean {
  if (!requesterId || requesterId !== session.userId) return true;
  return session.mayApproveOwn !== false;
}

/** The line shown instead of the buttons on one's own request. */
export const OWN_REQUEST_TEXT = 'You asked for this, so another owner or manager must approve it.';
