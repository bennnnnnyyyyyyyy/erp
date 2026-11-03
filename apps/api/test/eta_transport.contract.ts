import { describe, expect, it } from 'vitest';
import { buildDocument, submissionBodyJson, type EtaDocInput } from '@erp/shared';
import { EtaError, type EtaTransport } from '../src/lib/eta/transport';

// The contract every EtaTransport must honour. It asserts only what is true for BOTH the simulator and ETA itself (shapes, rules,
// error types), never a specific scenario, so the same suite can run against ETA PreProd and a divergence shows up as a failure.
// Scenario behaviour (rejected, pending, duplicates...) is simulator-only and lives in eta_transport.test.ts.

export type ContractOptions = {
  label: string;
  /** Creates a fresh transport for each test. */
  make: () => EtaTransport;
  /** The mode the transport must report; `simulated` also demands result.simulated === true everywhere. */
  expectMode: 'simulated' | 'preprod';
  /** A real system may refuse a placeholder issuer (400/403/422) instead of answering 202: that is a conforming answer too. */
  tolerateRefusal: boolean;
  /** The taxpayer to put on the test document (PreProd needs the registered test taxpayer; the simulator does not care). */
  issuer?: { id: string; branchId: string };
};

let seq = 0;
function testBody(opts: ContractOptions): { body: string; internalId: string } {
  seq += 1;
  const internalId = `CONTRACT-${Date.now().toString(36)}-${seq}`;
  const input: EtaDocInput = {
    kind: 'invoice',
    version: '0.9', // signature validation off: lets the contract run before any real signer exists
    issuer: {
      id: opts.issuer?.id ?? '100200300', name: 'Contract Test Seller', branchId: opts.issuer?.branchId ?? '0',
      address: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: '1 Test St', buildingNumber: '1' },
    },
    receiver: { type: 'B', id: '200300400', name: 'Contract Test Buyer', address: { country: 'EG', governate: 'Giza', regionCity: 'Dokki', street: '2 Test St', buildingNumber: '2' } },
    dateTimeIssued: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    taxpayerActivityCode: '4620',
    internalId,
    lines: [{ description: 'Contract item', itemType: 'EGS', itemCode: 'EG-100200300-CT', unitType: 'EA', quantity: '1', unitPriceEGP: '100.00', taxes: [{ taxType: 'T1', subType: 'V009', rate: '14' }] }],
  };
  return { body: submissionBodyJson([buildDocument(input).doc]), internalId };
}

const OVERALL = ['in progress', 'valid', 'partially valid', 'invalid'];
const DOC_STATUS = ['submitted', 'valid', 'invalid', 'rejected', 'cancelled'];

export function runTransportContract(opts: ContractOptions): void {
  const simulated = opts.expectMode === 'simulated';

  describe(`EtaTransport contract: ${opts.label}`, () => {
    it('reports its mode', () => {
      expect(opts.make().mode).toBe(opts.expectMode);
    });

    it('submit answers with a submission id and every document either accepted or rejected', async () => {
      const t = opts.make();
      const { body, internalId } = testBody(opts);
      let r;
      try {
        r = await t.submit(body);
      } catch (e) {
        if (!opts.tolerateRefusal) throw e;
        expect(e).toBeInstanceOf(EtaError);
        expect([400, 403, 422]).toContain((e as EtaError).status);
        expect(typeof (e as EtaError).code).toBe('string');
        return;
      }
      expect(r.simulated).toBe(simulated);
      expect(typeof r.submissionUUID).toBe('string');
      expect(r.submissionUUID.length).toBeGreaterThan(0);
      expect(r.acceptedDocuments.length + r.rejectedDocuments.length).toBe(1);
      for (const a of r.acceptedDocuments) {
        expect(a.internalId).toBe(internalId);
        expect(a.uuid).toBeTruthy();
        expect(a.longId).toBeTruthy();
      }
      for (const j of r.rejectedDocuments) {
        expect(typeof j.error.code).toBe('string');
        expect(typeof j.error.message).toBe('string');
      }
      expect(r.correlationId === null || typeof r.correlationId === 'string').toBe(true);
    });

    it('status of a submission has a documented overall status and per-document statuses', async () => {
      const t = opts.make();
      const { body } = testBody(opts);
      let r;
      try {
        r = await t.submit(body);
      } catch (e) {
        if (opts.tolerateRefusal && e instanceof EtaError) return;
        throw e;
      }
      if (r.acceptedDocuments.length === 0) return; // nothing to poll when the document was refused at submission
      const s = await t.getSubmission(r.submissionUUID);
      expect(s.simulated).toBe(simulated);
      expect(OVERALL).toContain(s.overallStatus);
      expect(typeof s.documentCount).toBe('number');
      expect(s.documents.length).toBeGreaterThan(0);
      for (const d of s.documents) {
        expect(DOC_STATUS).toContain(d.status);
        expect(d.internalId).toBeTruthy();
      }
    });

    it('rejects a body that is not a submission with a 400 EtaError', async () => {
      const t = opts.make();
      const e = (await t.submit('this is not json').catch((x) => x)) as EtaError;
      expect(e).toBeInstanceOf(EtaError);
      expect(e.status).toBe(400);
      expect(typeof e.code).toBe('string');
    });

    it('refuses a malformed submission id or document id before asking anything', async () => {
      const t = opts.make();
      await expect(t.getSubmission('../etc')).rejects.toThrow('INVALID_SUBMISSION_UUID');
      await expect(t.cancelDocument('../etc', 'x')).rejects.toThrow('INVALID_DOCUMENT_UUID');
    });

    it('requires a reason to cancel or reject', async () => {
      const t = opts.make();
      await expect(t.cancelDocument('ABCDEFGHIJ1234567890', '   ')).rejects.toThrow('REASON_REQUIRED');
      await expect(t.rejectDocument('ABCDEFGHIJ1234567890', '')).rejects.toThrow('REASON_REQUIRED');
    });

    it('answers an unknown submission or document with a 4xx EtaError, not a crash', async () => {
      const t = opts.make();
      const a = (await t.getSubmission('ZZZZZZZZZZ9999999999').catch((x) => x)) as EtaError;
      expect(a).toBeInstanceOf(EtaError);
      expect(a.status).toBeGreaterThanOrEqual(400);
      expect(a.status).toBeLessThan(500);
      const b = (await t.cancelDocument('ZZZZZZZZZZ9999999999', 'test').catch((x) => x)) as EtaError;
      expect(b).toBeInstanceOf(EtaError);
      expect(b.status).toBeGreaterThanOrEqual(400);
      expect(b.status).toBeLessThan(500);
    });
  });
}
