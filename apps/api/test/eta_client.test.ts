import { describe, expect, it } from 'vitest';
import { buildDocument, parseDoc, submissionBodyJson, type DocObject, type EtaDocInput } from '@erp/shared';
import { ETA_HOSTS, EtaClient, EtaError, type FetchLike } from '../src/lib/eta/client';

// The ETA client is written from the official SDK and has NOT been run against ETA. These tests pin the documented behaviour with a
// fake network: login once per hour, bearer token, exact body text, 202 handling, rate-limit and error mapping, one retry after a 401.

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeNetwork(handlers: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) };
    calls.push(call);
    const h = handlers[Math.min(i++, handlers.length - 1)];
    if (!h) throw new Error('no handler');
    return h(call);
  };
  return { calls, fetch };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', correlationId: 'CORR-1', ...headers } });
const tokenOk = (expiresIn = 3600) => () => json(200, { access_token: 'TOKEN-A', token_type: 'Bearer', expires_in: expiresIn });

const make = (handlers: ((c: Call) => Response)[], now: () => number = () => 0) => {
  const net = fakeNetwork(handlers);
  const client = new EtaClient({ environment: 'preprod', clientId: 'id-1', clientSecret: 'secret-1', fetch: net.fetch, now });
  return { client, calls: net.calls };
};

describe('login', () => {
  it('logs in with Basic auth and client_credentials on the identity host', async () => {
    const { client, calls } = make([tokenOk()]);
    expect(await client.token()).toBe('TOKEN-A');
    expect(calls[0]!.url).toBe(`${ETA_HOSTS.preprod.identity}/connect/token`);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${btoa('id-1:secret-1')}`);
    expect(calls[0]!.body).toContain('grant_type=client_credentials');
    expect(calls[0]!.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });
  it('caches the token for an hour and logs in again shortly before it expires', async () => {
    let t = 0;
    const { client, calls } = make([tokenOk(3600)], () => t);
    await client.token();
    t = 3_000_000; // 50 minutes
    await client.token();
    expect(calls.length).toBe(1);
    t = 3_560_000; // 59 minutes 20 seconds: inside the 60-second safety margin
    await client.token();
    expect(calls.length).toBe(2);
  });
  it('shares one login between concurrent calls', async () => {
    const { client, calls } = make([tokenOk()]);
    await Promise.all([client.token(), client.token(), client.token()]);
    expect(calls.length).toBe(1);
  });
  it('turns a refused login into a clear error', async () => {
    const { client } = make([() => json(400, { error: 'invalid_client' })]);
    await expect(client.token()).rejects.toMatchObject({ name: 'EtaError', status: 400, code: 'invalid_client' });
  });
  it('uses the production hosts for production', () => {
    expect(ETA_HOSTS.production.api).toBe('https://api.invoicing.eta.gov.eg');
    expect(ETA_HOSTS.production.identity).toBe('https://id.eta.gov.eg');
  });
  it('refuses to start without credentials', () => {
    expect(() => new EtaClient({ environment: 'preprod', clientId: '', clientSecret: '' })).toThrow('ETA_CREDENTIALS_MISSING');
  });
});

const input = (): EtaDocInput => ({
  kind: 'invoice', version: '0.9',
  issuer: { id: '100200300', name: 'Test Seller LLC', branchId: '0', address: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: '1 Test St', buildingNumber: '1' } },
  receiver: { type: 'B', id: '200300400', name: 'Buyer', address: { country: 'EG', governate: 'Giza', regionCity: 'Dokki', street: '2 Test St', buildingNumber: '2' } },
  dateTimeIssued: '2026-11-02T10:15:00Z', taxpayerActivityCode: '4620', internalId: 'INV-1',
  lines: [{ description: 'Cream', itemType: 'EGS', itemCode: 'EG-100200300-FC', unitType: 'EA', quantity: '1', unitPriceEGP: '125.50', taxes: [{ taxType: 'T1', subType: 'V009', rate: '14' }] }],
});

describe('submit', () => {
  it('posts the exact text with a bearer token and returns the accepted documents and the correlation id', async () => {
    const { doc } = buildDocument(input());
    const body = submissionBodyJson([doc]);
    const { client, calls } = make([
      tokenOk(),
      () => json(202, { submissionUUID: 'SUBMISSION123456789012345', acceptedDocuments: [{ uuid: 'UUID1234567890', longId: 'LONG', internalId: 'INV-1' }], rejectedDocuments: [] }),
    ]);
    const r = await client.submit(body);
    expect(r.submissionUUID).toBe('SUBMISSION123456789012345');
    expect(r.acceptedDocuments[0]!.internalId).toBe('INV-1');
    expect(r.correlationId).toBe('CORR-1');
    const post = calls[1]!;
    expect(post.url).toBe(`${ETA_HOSTS.preprod.api}/api/v1.0/documentsubmissions/`);
    expect(post.headers.Authorization).toBe('Bearer TOKEN-A');
    expect(post.body).toBe(body);
    // The number text survives untouched: 125.50 is not turned into 125.5.
    expect(post.body).toContain('"amountEGP":125.50');
    expect((parseDoc(post.body!) as DocObject).documents).toHaveLength(1);
  });
  it('reports rejected documents without throwing (a 202 is not a failure)', async () => {
    const { client } = make([tokenOk(), () => json(202, { submissionUUID: 'S', acceptedDocuments: [], rejectedDocuments: [{ internalId: 'INV-1', error: { code: 'BadStructure', message: 'bad' } }] })]);
    const r = await client.submit('{"documents":[]}');
    expect(r.rejectedDocuments[0]!.error.code).toBe('BadStructure');
  });
  it('maps 429 to a retryable error that carries Retry-After', async () => {
    const { client } = make([tokenOk(), () => json(429, { error: { code: 'TooManyRequests', message: 'slow down' } }, { 'Retry-After': '7' })]);
    const err = await client.submit('{}').catch((e) => e as EtaError);
    expect(err).toBeInstanceOf(EtaError);
    expect(err).toMatchObject({ status: 429, code: 'TooManyRequests', retryAfterSeconds: 7, retryable: true, correlationId: 'CORR-1' });
  });
  it('maps 422 DuplicateSubmission to a retryable error with the wait time, and 503 to retryable', async () => {
    const dup = make([tokenOk(), () => json(422, { error: { code: 'DuplicateSubmission', message: 'dup' } }, { 'Retry-After': '540' })]);
    expect(await dup.client.submit('{}').catch((e) => e)).toMatchObject({ status: 422, retryAfterSeconds: 540, retryable: true });
    const down = make([tokenOk(), () => json(503, { error: { code: 'ServiceUnavailable', message: 'x' } })]);
    expect(await down.client.submit('{}').catch((e) => e)).toMatchObject({ status: 503, retryable: true });
  });
  it('does not treat a structure error as retryable', async () => {
    const { client } = make([tokenOk(), () => json(400, { error: { code: 'BadStructure', message: 'bad', details: [{ code: 'x' }] } })]);
    const err = (await client.submit('{}').catch((e) => e)) as EtaError;
    expect(err).toMatchObject({ status: 400, code: 'BadStructure', retryable: false });
    expect(err.details).toEqual([{ code: 'x' }]);
  });
  it('logs in again once after a 401 and then retries once, never in a loop', async () => {
    let posts = 0;
    const { client, calls } = make([
      tokenOk(),
      () => { posts++; return json(401, { error: { code: 'Unauthorized', message: 'expired' } }); },
      tokenOk(),
      () => { posts++; return json(401, { error: { code: 'Unauthorized', message: 'still' } }); },
    ]);
    await expect(client.submit('{}')).rejects.toMatchObject({ status: 401 });
    expect(posts).toBe(2);
    expect(calls.filter((c) => c.url.includes('/connect/token')).length).toBe(2);
  });
});

describe('status, cancel, reject', () => {
  it('reads a submission using the documented fields', async () => {
    const { client, calls } = make([tokenOk(), () => json(200, { uuid: 'SUBMISSION123456789012345', documentCount: 1, overallStatus: 'valid', documentSummary: [{ uuid: 'UUID1234567890', internalId: 'INV-1', status: 'valid', longId: 'LONG', total: 1430.7 }] })]);
    const s = await client.getSubmission('SUBMISSION123456789012345');
    expect(s.overallStatus).toBe('valid');
    expect(s.documents[0]).toMatchObject({ uuid: 'UUID1234567890', status: 'valid', total: 1430.7 });
    expect(calls[1]!.url).toBe(`${ETA_HOSTS.preprod.api}/api/v1.0/documentsubmissions/SUBMISSION123456789012345?pageNo=1&pageSize=100`);
  });
  it('rejects a malformed submission id before calling out', async () => {
    const { client, calls } = make([tokenOk()]);
    await expect(client.getSubmission('../etc')).rejects.toThrow('INVALID_SUBMISSION_UUID');
    expect(calls.length).toBe(0);
  });
  it('cancels and rejects with the documented body', async () => {
    const { client, calls } = make([tokenOk(), () => json(200, {})]);
    await client.cancelDocument('UUID1234567890', ' wrong customer ');
    expect(calls[1]!.method).toBe('PUT');
    expect(calls[1]!.url).toBe(`${ETA_HOSTS.preprod.api}/api/v1.0/documents/state/UUID1234567890/state`);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ status: 'cancelled', reason: 'wrong customer' });
    await client.rejectDocument('UUID1234567890', 'not ordered');
    expect(JSON.parse(calls[2]!.body!)).toEqual({ status: 'rejected', reason: 'not ordered' });
    await expect(client.cancelDocument('UUID1234567890', '  ')).rejects.toThrow('REASON_REQUIRED');
  });
  it('sends onbehalfof only when acting for a taxpayer, and the language header always', async () => {
    const net = fakeNetwork([tokenOk(), () => json(200, {})]);
    const client = new EtaClient({ environment: 'production', clientId: 'a', clientSecret: 'b', onBehalfOf: '100200300', language: 'ar', fetch: net.fetch });
    await client.getDocumentType(1);
    expect(net.calls[1]!.headers.onbehalfof).toBe('100200300');
    expect(net.calls[1]!.headers['Accept-Language']).toBe('ar');
    expect(net.calls[1]!.url.startsWith(ETA_HOSTS.production.api)).toBe(true);
  });
});
