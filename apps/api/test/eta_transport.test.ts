import { describe, expect, it } from 'vitest';
import {
  SIMULATED_BADGE, StubSigner, badgeFor, buildDocument, isSimulationId, recordIsConsistent, submissionBodyJson, toSendRecord,
  type EtaDocInput, type Signer,
} from '@erp/shared';
import { EtaClient } from '../src/lib/eta/client';
import { SimulatedTransport, type SimulatedScenario } from '../src/lib/eta/simulated';
import { EtaError, EtaModeError, transportFor, type EtaTransport, type TransportFactories } from '../src/lib/eta/transport';
import { runTransportContract } from './eta_transport.contract';

// One contract, two implementations. The simulator always runs. ETA PreProd runs only when credentials are present in the
// environment (ETA_PREPROD_CLIENT_ID and ETA_PREPROD_CLIENT_SECRET, optionally ETA_PREPROD_REG_NUMBER and ETA_PREPROD_BRANCH_ID);
// otherwise the suite below is reported as SKIPPED, never silently dropped and never run against a fake pretending to be PreProd.

runTransportContract({ label: 'SimulatedTransport', make: () => new SimulatedTransport(), expectMode: 'simulated', tolerateRefusal: false });

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const preprod = { id: env.ETA_PREPROD_CLIENT_ID, secret: env.ETA_PREPROD_CLIENT_SECRET };
const havePreprod = Boolean(preprod.id && preprod.secret);

describe.skipIf(!havePreprod)('PreProd (skipped unless ETA_PREPROD_CLIENT_ID and ETA_PREPROD_CLIENT_SECRET are set)', () => {
  runTransportContract({
    label: 'EtaClient on ETA PreProd',
    make: () => new EtaClient({ environment: 'preprod', clientId: preprod.id as string, clientSecret: preprod.secret as string }),
    expectMode: 'preprod',
    tolerateRefusal: true,
    issuer: { id: env.ETA_PREPROD_REG_NUMBER ?? '100200300', branchId: env.ETA_PREPROD_BRANCH_ID ?? '0' },
  });
});

const input = (internalId: string): EtaDocInput => ({
  kind: 'invoice', version: '0.9',
  issuer: { id: '100200300', name: 'Seller', branchId: '0', address: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: '1 St', buildingNumber: '1' } },
  receiver: { type: 'B', id: '200300400', name: 'Buyer', address: { country: 'EG', governate: 'Giza', regionCity: 'Dokki', street: '2 St', buildingNumber: '2' } },
  dateTimeIssued: '2026-11-02T10:15:00Z', taxpayerActivityCode: '4620', internalId,
  lines: [{ description: 'Item', itemType: 'EGS', itemCode: 'EG-100200300-X', unitType: 'EA', quantity: '1', unitPriceEGP: '100.00', taxes: [{ taxType: 'T1', subType: 'V009', rate: '14' }] }],
});
const body = (...ids: string[]) => submissionBodyJson(ids.map((i) => buildDocument(input(i)).doc));

describe('SimulatedTransport scenarios', () => {
  it('accepted: accepted at submission and valid on the first status check', async () => {
    const t = new SimulatedTransport({ scenario: 'accepted' });
    const r = await t.submit(body('A-1'));
    expect(r.acceptedDocuments).toHaveLength(1);
    expect(r.rejectedDocuments).toHaveLength(0);
    const s = await t.getSubmission(r.submissionUUID);
    expect(s.overallStatus).toBe('valid');
    expect(s.documents[0]).toMatchObject({ internalId: 'A-1', status: 'valid' });
  });
  it('rejected: refused at submission with an error, nothing to poll', async () => {
    const t = new SimulatedTransport({ scenario: 'rejected' });
    const r = await t.submit(body('R-1'));
    expect(r.acceptedDocuments).toHaveLength(0);
    expect(r.rejectedDocuments[0]).toMatchObject({ internalId: 'R-1', error: { code: 'SimulatedRejection' } });
    expect((await t.getSubmission(r.submissionUUID)).overallStatus).toBe('invalid');
  });
  it('pending: in progress for the configured number of checks, then valid', async () => {
    const t = new SimulatedTransport({ scenario: 'pending', pendingPolls: 2 });
    const r = await t.submit(body('P-1'));
    const first = await t.getSubmission(r.submissionUUID);
    expect(first.overallStatus).toBe('in progress');
    expect(first.documents[0]!.status).toBe('submitted');
    expect((await t.getSubmission(r.submissionUUID)).overallStatus).toBe('in progress');
    const done = await t.getSubmission(r.submissionUUID);
    expect(done.overallStatus).toBe('valid');
    expect(done.documents[0]!.status).toBe('valid');
  });
  it('a scenario function decides per document, so one submission can mix outcomes', async () => {
    const pick = (id: string): SimulatedScenario => (id.startsWith('BAD') ? 'rejected' : id.startsWith('SLOW') ? 'pending' : 'accepted');
    const t = new SimulatedTransport({ scenario: pick });
    const r = await t.submit(body('OK-1', 'BAD-1', 'SLOW-1'));
    expect(r.acceptedDocuments.map((d) => d.internalId)).toEqual(['OK-1', 'SLOW-1']);
    expect(r.rejectedDocuments.map((d) => d.internalId)).toEqual(['BAD-1']);
    expect((await t.getSubmission(r.submissionUUID)).overallStatus).toBe('in progress');
  });
  it('cancel and reject follow the documented states', async () => {
    const t = new SimulatedTransport({ scenario: (id) => (id === 'SLOW' ? 'pending' : 'accepted') });
    const r = await t.submit(body('DONE', 'SLOW'));
    const done = r.acceptedDocuments.find((d) => d.internalId === 'DONE')!;
    const slow = r.acceptedDocuments.find((d) => d.internalId === 'SLOW')!;
    await expect(t.cancelDocument(slow.uuid, 'too early')).rejects.toMatchObject({ status: 400, code: 'IncorrectState' });
    await t.cancelDocument(done.uuid, 'wrong customer');
    await expect(t.cancelDocument(done.uuid, 'again')).rejects.toMatchObject({ status: 400, code: 'IncorrectState' });
    await expect(t.rejectDocument(done.uuid, 'no')).rejects.toMatchObject({ status: 400, code: 'IncorrectState' });
    expect((await t.getSubmission(r.submissionUUID)).documents.find((d) => d.uuid === done.uuid)!.status).toBe('cancelled');
  });
  it('treats an identical payload within 10 minutes as a duplicate (422 with a wait time), and allows it afterwards', async () => {
    let now = 0;
    const t = new SimulatedTransport({ now: () => now });
    const b = body('D-1');
    await t.submit(b);
    now = 60_000;
    const e = (await t.submit(b).catch((x) => x)) as EtaError;
    expect(e).toMatchObject({ status: 422, code: 'DuplicateSubmission', retryable: true });
    expect(e.retryAfterSeconds).toBe(540);
    now = 601_000;
    await expect(t.submit(b)).resolves.toMatchObject({ simulated: true });
  });
  it('every id it hands out is visibly simulated and nothing in it can pass for an ETA id', async () => {
    const t = new SimulatedTransport();
    const r = await t.submit(body('I-1'));
    for (const id of [r.submissionUUID, r.acceptedDocuments[0]!.uuid, r.acceptedDocuments[0]!.longId]) expect(isSimulationId(id)).toBe(true);
    expect(r.simulated).toBe(true);
  });
  it('makes no network call (it imports no HTTP client and never touches fetch)', async () => {
    const original = globalThis.fetch;
    let called = 0;
    globalThis.fetch = (() => { called += 1; throw new Error('network used'); }) as typeof fetch;
    try {
      const t = new SimulatedTransport();
      const r = await t.submit(body('N-1'));
      await t.getSubmission(r.submissionUUID);
      await t.cancelDocument(r.acceptedDocuments[0]!.uuid, 'x');
    } finally {
      globalThis.fetch = original;
    }
    expect(called).toBe(0);
  });
});

describe('what a simulated send may store and show', () => {
  it('stores no real ETA reference and carries the badge', async () => {
    const t = new SimulatedTransport();
    const r = await t.submit(body('S-1'));
    const rec = toSendRecord(t.mode, r.submissionUUID, r.acceptedDocuments[0]!);
    expect(rec).toMatchObject({ mode: 'simulated', simulated: true, badge: SIMULATED_BADGE, etaUuid: null, etaLongId: null, etaSubmissionUuid: null });
    expect(rec.simulationId).toBe(r.acceptedDocuments[0]!.uuid);
    expect(recordIsConsistent(rec)).toBe(true);
    expect(badgeFor(rec)).toBe('SIMULATED, not sent to ETA');
  });
  it('drops ETA reference fields even if a caller passes real-looking ones in simulated mode', () => {
    const rec = toSendRecord('simulated', 'REALSUBMISSION1234', { uuid: 'REALDOCUMENT123456', longId: 'REALLONGID', internalId: 'X' });
    expect(rec.etaUuid).toBeNull();
    expect(rec.etaLongId).toBeNull();
    expect(rec.etaSubmissionUuid).toBeNull();
    expect(recordIsConsistent(rec)).toBe(true);
  });
  it('a real send stores the ETA references and no badge, and refuses a simulated id', () => {
    const rec = toSendRecord('preprod', 'SUBMISSION123456', { uuid: 'DOCUMENT1234567', longId: 'LONG', internalId: 'X' });
    expect(rec).toMatchObject({ simulated: false, badge: null, etaUuid: 'DOCUMENT1234567', etaSubmissionUuid: 'SUBMISSION123456', simulationId: null });
    expect(badgeFor(rec)).toBeNull();
    expect(recordIsConsistent(rec)).toBe(true);
    expect(() => toSendRecord('preprod', 'SUBMISSION123456', { uuid: 'SIMULATED-DOC-0001', longId: 'L', internalId: 'X' })).toThrow('SIMULATED_ID_IN_REAL_MODE');
    expect(() => toSendRecord('production', 'SIMULATED-SUB-0001', { uuid: 'DOCUMENT1234567', longId: 'L', internalId: 'X' })).toThrow('SIMULATED_ID_IN_REAL_MODE');
  });
  it('flags an inconsistent record (simulated with an ETA reference, real without one)', () => {
    const good = toSendRecord('simulated', 'S', { uuid: 'SIMULATED-DOC-0001', longId: 'L', internalId: 'X' });
    expect(recordIsConsistent({ ...good, etaUuid: 'REAL1234567890' })).toBe(false);
    expect(recordIsConsistent({ ...good, badge: null })).toBe(false);
    const real = toSendRecord('preprod', 'SUBMISSION123456', { uuid: 'DOCUMENT1234567', longId: 'L', internalId: 'X' });
    expect(recordIsConsistent({ ...real, etaUuid: null })).toBe(false);
    expect(recordIsConsistent({ ...real, badge: SIMULATED_BADGE })).toBe(false);
  });
});

describe('choosing the transport for a company', () => {
  const sim = new SimulatedTransport();
  const real = (environment: 'preprod' | 'production') => ({ mode: environment }) as unknown as EtaTransport;
  const factories: TransportFactories = { simulated: () => sim, real };
  const creds = { clientId: 'id', clientSecret: 'secret' };
  const realSigner: Signer = { kind: 'real', sign: async () => 'sig' };

  it('defaults to simulated, needs nothing for it, and never uses the real factory', () => {
    expect(transportFor({ mode: undefined, credentials: null, signer: null }, factories)).toBe(sim);
    expect(transportFor({ mode: null, credentials: null, signer: null }, factories)).toBe(sim);
    expect(transportFor({ mode: 'simulated', credentials: creds, signer: realSigner }, factories)).toBe(sim);
  });
  it('preprod needs credentials; it does not need a real signer (version 0.9 documents are not signature-checked)', () => {
    expect(() => transportFor({ mode: 'preprod', credentials: null, signer: null }, factories)).toThrow(EtaModeError);
    expect(() => transportFor({ mode: 'preprod', credentials: { clientId: '', clientSecret: '' }, signer: null }, factories)).toThrow(/credentials/i);
    expect(transportFor({ mode: 'preprod', credentials: creds, signer: null }, factories).mode).toBe('preprod');
  });
  it('production is refused without credentials, and refused with credentials but no real signer (the stub never qualifies)', () => {
    const code = (f: () => unknown) => { try { f(); return 'allowed'; } catch (e) { return (e as EtaModeError).code; } };
    expect(code(() => transportFor({ mode: 'production', credentials: null, signer: realSigner }, factories))).toBe('CREDENTIALS_MISSING');
    expect(code(() => transportFor({ mode: 'production', credentials: creds, signer: null }, factories))).toBe('PRODUCTION_NOT_READY');
    expect(code(() => transportFor({ mode: 'production', credentials: creds, signer: new StubSigner() }, factories))).toBe('PRODUCTION_NOT_READY');
    expect(transportFor({ mode: 'production', credentials: creds, signer: realSigner }, factories).mode).toBe('production');
  });
  it('an unknown mode is an error, never a quiet fallback to simulated or to a real system', () => {
    expect(() => transportFor({ mode: 'live', credentials: creds, signer: realSigner }, factories)).toThrow(EtaModeError);
    try { transportFor({ mode: 'live', credentials: creds, signer: realSigner }, factories); } catch (e) { expect((e as EtaModeError).code).toBe('INVALID_MODE'); }
  });
  it('the stub signer says it is a stub', () => {
    expect(new StubSigner().kind).toBe('stub');
  });
});
