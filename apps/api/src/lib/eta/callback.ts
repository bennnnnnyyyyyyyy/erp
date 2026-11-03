// Parsing and authentication for the notification ETA sends to us: `PUT /notifications/documents` (official page "ERP - Receive
// Document Notifications"). Pure functions only: the route, the per-company key storage and the event table come with slice D, after
// the credentials-storage decision (plan section 6.2).
//
// Facts from the SDK: ETA authenticates itself with `Authorization: ApiKey <pre-shared key>`; the body is
// { deliveryId, type: "document", count, message: [{ type, uuid, submissionUUID, longId, internalId, status }] }; the endpoint must be
// idempotent (deliveryId is the dedupe key) and answer 200, otherwise ETA retries. The base URL is shared once per company at
// registration, so in this multi-tenant app it must carry the company, for example /webhooks/eta/<company id>/notifications/documents.

import { safeEqual } from '../whatsapp';

export type NotificationType = 'document-validated' | 'document-received' | 'document-rejected' | 'document-cancelled';
export type NotificationStatus = 'valid' | 'invalid' | 'cancelled' | 'rejected' | 'unknown';

export type DocumentNotification = {
  type: NotificationType;
  uuid: string;
  submissionUUID: string;
  longId: string;
  internalId: string;
  /** Lower-cased from ETA's `Valid` / `Invalid` / `Cancelled` / `Rejected`; anything else is `unknown` (and kept in rawStatus). */
  status: NotificationStatus;
  rawStatus: string;
};

export type NotificationBatch = { deliveryId: string; count: number; messages: DocumentNotification[] };

const TYPES: readonly string[] = ['document-validated', 'document-received', 'document-rejected', 'document-cancelled'];
const STATUSES: readonly string[] = ['valid', 'invalid', 'cancelled', 'rejected'];
const MAX_MESSAGES = 1000;

/** True when the header is `ApiKey <expected key>`. Constant-time, and false when no key is configured. */
export function verifyApiKey(header: string | undefined | null, expectedKey: string | undefined | null): boolean {
  if (!header || !expectedKey) return false;
  const m = /^ApiKey\s+(.+)$/.exec(header.trim());
  return m !== null && safeEqual(m[1] as string, expectedKey);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Returns the batch, or null when the body is not a document notification we understand (the route still answers 200 to a valid key). */
export function parseNotification(body: unknown): NotificationBatch | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const deliveryId = str(b.deliveryId);
  if (!deliveryId || deliveryId.length > 200 || b.type !== 'document' || !Array.isArray(b.message)) return null;
  const messages: DocumentNotification[] = [];
  for (const raw of b.message.slice(0, MAX_MESSAGES)) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    const type = str(m.type);
    const uuid = str(m.uuid);
    if (!TYPES.includes(type) || !uuid) continue;
    const rawStatus = str(m.status);
    const lower = rawStatus.toLowerCase();
    messages.push({
      type: type as NotificationType,
      uuid,
      submissionUUID: str(m.submissionUUID),
      longId: str(m.longId),
      internalId: str(m.internalId),
      status: (STATUSES.includes(lower) ? lower : 'unknown') as NotificationStatus,
      rawStatus,
    });
  }
  return { deliveryId, count: typeof b.count === 'number' ? b.count : messages.length, messages };
}
