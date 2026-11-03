import { describe, expect, it } from 'vitest';
import { parseNotification, verifyApiKey } from '../src/lib/eta/callback';

// Pure parsing and key checks for ETA's `PUT /notifications/documents` (documentation/reference/eta-sdk/2026-11-02/md/einvoicingapi/14-*).

describe('ApiKey check', () => {
  it('accepts exactly the configured key', () => {
    expect(verifyApiKey('ApiKey s3cret-key', 's3cret-key')).toBe(true);
    expect(verifyApiKey('  ApiKey   s3cret-key ', 's3cret-key')).toBe(true);
  });
  it('rejects a wrong key, another scheme, a missing header, and an unconfigured key', () => {
    expect(verifyApiKey('ApiKey nope', 's3cret-key')).toBe(false);
    expect(verifyApiKey('Bearer s3cret-key', 's3cret-key')).toBe(false);
    expect(verifyApiKey('s3cret-key', 's3cret-key')).toBe(false);
    expect(verifyApiKey(undefined, 's3cret-key')).toBe(false);
    expect(verifyApiKey('ApiKey ', 's3cret-key')).toBe(false);
    expect(verifyApiKey('ApiKey x', undefined)).toBe(false);
    expect(verifyApiKey('ApiKey ', '')).toBe(false);
    expect(verifyApiKey('ApiKey s3cret-key-extra', 's3cret-key')).toBe(false);
  });
});

describe('notification parsing', () => {
  const body = {
    deliveryId: '838847HS2', type: 'document', count: 2,
    message: [
      { type: 'document-validated', uuid: 'F9D425P6DS7D8IU', submissionUUID: 'JU7GH07JNA23N', longId: 'LONG1', internalId: 'INV-1', status: 'Valid' },
      { type: 'document-cancelled', uuid: 'G0E536Q7ET8E9JV', submissionUUID: 'JU7GH07JNA23N', longId: 'LONG2', internalId: 'INV-2', status: 'Cancelled' },
    ],
  };
  it('reads the documented structure and normalises status', () => {
    const r = parseNotification(body)!;
    expect(r.deliveryId).toBe('838847HS2');
    expect(r.count).toBe(2);
    expect(r.messages.map((m) => [m.type, m.status])).toEqual([['document-validated', 'valid'], ['document-cancelled', 'cancelled']]);
    expect(r.messages[0]).toMatchObject({ uuid: 'F9D425P6DS7D8IU', internalId: 'INV-1', rawStatus: 'Valid' });
  });
  it('keeps an unexpected status as unknown instead of guessing', () => {
    const r = parseNotification({ ...body, message: [{ type: 'document-received', uuid: 'U1', status: 'In Progress' }] })!;
    expect(r.messages[0]).toMatchObject({ status: 'unknown', rawStatus: 'In Progress' });
  });
  it('skips malformed messages but keeps the good ones', () => {
    const r = parseNotification({ ...body, message: [null, 5, { type: 'surprise', uuid: 'U' }, { type: 'document-rejected' }, { type: 'document-rejected', uuid: 'U2', status: 'Rejected' }] })!;
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({ uuid: 'U2', status: 'rejected' });
  });
  it('returns null for anything that is not a document notification', () => {
    for (const bad of [null, 'x', 5, [], {}, { deliveryId: '', type: 'document', message: [] }, { deliveryId: 'd', type: 'receipt', message: [] }, { deliveryId: 'd', type: 'document' }]) {
      expect(parseNotification(bad)).toBeNull();
    }
  });
  it('caps the batch size', () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({ type: 'document-received', uuid: `U${i}`, status: 'Valid' }));
    expect(parseNotification({ deliveryId: 'd', type: 'document', message: many })!.messages).toHaveLength(1000);
  });
});
