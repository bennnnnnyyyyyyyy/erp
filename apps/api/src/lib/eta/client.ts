// HTTP client for the Egyptian Tax Authority (ETA) eInvoicing API. Written from the official SDK (offline copy in
// documentation/reference/eta-sdk/2026-11-02/, plan section 3), NOT yet run against ETA: PreProd credentials do not exist yet.
// Treat every field name below as "documented, unverified on PreProd" until the first manual test.
//
// Design rules taken from the SDK:
//  * Log in once per hour, not per call: the token (JWT, expires_in 3600) is cached and refreshed shortly before it expires.
//  * Send the submission as the exact signed text (see submissionBodyJson); never re-serialize it.
//  * 202 on submit means "accepted for processing", not "valid". Never resubmit after a 20x (it counts as a duplicate and repeated
//    duplicates lead to throttling); the caller resubmits only after an error from this client.
//  * 429: wait longer than Retry-After. 503: retry after 1 to 3 seconds. 422 DuplicateSubmission: wait out the 10 minutes.
//  * Every response carries a correlationId; it is returned/attached to errors because ETA support asks for it.
// This file holds no secrets and reads none: the caller passes the company's Client ID and secret in memory.

import { EtaError, type DocumentStatus, type EtaTransport, type SubmissionStatus, type SubmitResult } from './transport';

export { EtaError };

/** The two real ETA systems. (simulated is not an environment: it never reaches this client.) */
export type EtaEnvironment = 'preprod' | 'production';

export const ETA_HOSTS: Record<EtaEnvironment, { api: string; identity: string }> = {
  preprod: { api: 'https://api.preprod.invoicing.eta.gov.eg', identity: 'https://id.preprod.eta.gov.eg' },
  production: { api: 'https://api.invoicing.eta.gov.eg', identity: 'https://id.eta.gov.eg' },
};

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

export type EtaClientOptions = {
  environment: EtaEnvironment;
  clientId: string;
  clientSecret: string;
  /** Registration number of the taxpayer, only when an intermediary system acts on a company's behalf. */
  onBehalfOf?: string;
  language?: 'en' | 'ar';
  fetch?: FetchLike;
  /** Milliseconds since epoch; injectable for tests. */
  now?: () => number;
  scope?: string;
};

const SKEW_MS = 60_000;

function toBase64(s: string): string {
  const g = globalThis as unknown as { btoa?: (x: string) => string };
  if (!g.btoa) throw new Error('btoa is not available in this runtime');
  return g.btoa(s);
}

export class EtaClient implements EtaTransport {
  get mode(): EtaEnvironment {
    return this.o.environment;
  }
  private readonly o: Required<Pick<EtaClientOptions, 'environment' | 'clientId' | 'clientSecret'>> & EtaClientOptions;
  private readonly doFetch: FetchLike;
  private readonly now: () => number;
  private cached: { token: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(options: EtaClientOptions) {
    if (!options.clientId || !options.clientSecret) throw new Error('ETA_CREDENTIALS_MISSING');
    this.o = options;
    this.doFetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => Date.now());
  }

  private hosts() {
    return ETA_HOSTS[this.o.environment];
  }

  private baseHeaders(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', 'Accept-Language': this.o.language ?? 'en' };
    if (this.o.onBehalfOf) h.onbehalfof = this.o.onBehalfOf;
    return h;
  }

  /** The access token, cached until shortly before it expires. Concurrent callers share one login. */
  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt - SKEW_MS > this.now()) return this.cached.token;
    if (!this.inflight) {
      this.inflight = this.login().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async login(): Promise<string> {
    const body = new URLSearchParams({ grant_type: 'client_credentials', scope: this.o.scope ?? 'InvoicingAPI' }).toString();
    const res = await this.doFetch(`${this.hosts().identity}/connect/token`, {
      method: 'POST',
      headers: {
        ...this.baseHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${toBase64(`${this.o.clientId}:${this.o.clientSecret}`)}`,
      },
      body,
    });
    const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
    if (!res.ok || !json?.access_token) {
      // The identity service answers with { error: "invalid_client" } style bodies, not the API's error object.
      throw new EtaError(res.status, json?.error ?? 'LoginFailed', 'ETA refused the login (check the Client ID, the Client Secret and the environment)', res.headers.get('correlationId'), null);
    }
    const lifetimeMs = (typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600) * 1000;
    this.cached = { token: json.access_token, expiresAt: this.now() + lifetimeMs };
    return json.access_token;
  }

  private async call<T>(method: string, path: string, body?: string, extraHeaders: Record<string, string> = {}): Promise<{ data: T; correlationId: string | null; status: number }> {
    const doOnce = async () =>
      this.doFetch(`${this.hosts().api}${path}`, {
        method,
        headers: { ...this.baseHeaders(), ...extraHeaders, Authorization: `Bearer ${await this.token()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body } : {}),
      });
    let res = await doOnce();
    if (res.status === 401 && this.cached) {
      // The token may have been revoked or expired early: log in once more, then try once. Not a loop.
      this.cached = null;
      res = await doOnce();
    }
    const correlationId = res.headers.get('correlationId');
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      const retryAfter = Number(res.headers.get('Retry-After'));
      throw new EtaError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `ETA answered ${res.status}`, correlationId, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null, err?.details);
    }
    return { data: json as T, correlationId, status: res.status };
  }

  /** POST /api/v1.0/documentsubmissions/. `bodyJson` is the exact text from submissionBodyJson. */
  async submit(bodyJson: string): Promise<SubmitResult> {
    const { data, correlationId } = await this.call<Omit<SubmitResult, 'correlationId' | 'simulated'>>('POST', '/api/v1.0/documentsubmissions/', bodyJson);
    return {
      simulated: false,
      submissionUUID: data.submissionUUID,
      acceptedDocuments: data.acceptedDocuments ?? [],
      rejectedDocuments: data.rejectedDocuments ?? [],
      correlationId,
    };
  }

  /** GET /api/v1.0/documentsubmissions/{uuid}. Polling fallback when callbacks are not available. */
  async getSubmission(submissionUuid: string, pageNo = 1, pageSize = 100): Promise<SubmissionStatus> {
    if (!/^[A-Za-z0-9]{10,40}$/.test(submissionUuid)) throw new Error('INVALID_SUBMISSION_UUID');
    // Response fields per the Get Submission page: uuid, documentCount, overallStatus, documentSummary[] (uuid, longId, internalId, status, total, ...).
    // Per-document validation errors are NOT in this summary; they come from Get Document Details (not built yet).
    const { data, correlationId } = await this.call<{ uuid?: string; documentCount: number; overallStatus: SubmissionStatus['overallStatus']; documentSummary?: { uuid: string; internalId: string; status: DocumentStatus; longId?: string; total?: number }[] }>(
      'GET', `/api/v1.0/documentsubmissions/${submissionUuid}?pageNo=${pageNo}&pageSize=${pageSize}`);
    return {
      simulated: false,
      submissionUUID: data.uuid ?? submissionUuid,
      overallStatus: data.overallStatus,
      documentCount: data.documentCount,
      documents: (data.documentSummary ?? []).map((d) => ({ uuid: d.uuid, internalId: d.internalId, status: d.status, ...(d.longId ? { longId: d.longId } : {}), ...(d.total !== undefined ? { total: d.total } : {}) })),
      correlationId,
    };
  }

  /** PUT /api/v1.0/documents/state/{uuid}/state. Issuer cancels, receiver rejects; inside the window ETA publishes per document type. */
  private async setState(documentUuid: string, status: 'cancelled' | 'rejected', reason: string): Promise<{ correlationId: string | null }> {
    if (!/^[A-Za-z0-9]{10,40}$/.test(documentUuid)) throw new Error('INVALID_DOCUMENT_UUID');
    if (!reason.trim()) throw new Error('REASON_REQUIRED');
    const { correlationId } = await this.call<unknown>('PUT', `/api/v1.0/documents/state/${documentUuid}/state`, JSON.stringify({ status, reason: reason.trim() }));
    return { correlationId };
  }
  cancelDocument(documentUuid: string, reason: string) {
    return this.setState(documentUuid, 'cancelled', reason);
  }
  rejectDocument(documentUuid: string, reason: string) {
    return this.setState(documentUuid, 'rejected', reason);
  }

  /** GET /api/v1.0/documenttypes/{id}: includes the workflow parameters (cancel and reject windows). Read at runtime, never hardcode 72 hours. */
  async getDocumentType(id: number): Promise<unknown> {
    return (await this.call<unknown>('GET', `/api/v1.0/documenttypes/${id}`)).data;
  }
}
