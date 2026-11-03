// The one door to ETA. Everything in the app that talks to ETA does it through an EtaTransport, never through a concrete client, so
// a company's mode decides what actually happens:
//   simulated  -> SimulatedTransport (simulated.ts): answers like ETA, sends nothing, labels everything SIMULATED
//   preprod    -> EtaClient (client.ts) against ETA's test system
//   production -> EtaClient against ETA's live system, refused unless credentials AND a real signer are configured
// One shared contract test (test/eta_transport.contract.ts) runs against the simulator always and against PreProd only when
// credentials are present, so the simulator cannot drift from the real thing without a test noticing.
// See documentation/plans/ETA_EINVOICING_PLAN.md section 14.

import { DEFAULT_ETA_MODE, isEtaMode, type EtaMode, type Signer } from '@erp/shared';

export class EtaError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | null;
  /** Seconds to wait before trying again, when ETA said so (429 Retry-After, 422 DuplicateSubmission). */
  readonly retryAfterSeconds: number | null;
  readonly details: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    correlationId: string | null,
    retryAfterSeconds: number | null,
    details?: unknown,
  ) {
    super(message);
    this.name = 'EtaError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.retryAfterSeconds = retryAfterSeconds;
    this.details = details;
  }
  /** True when trying the same request again later can succeed (rate limit, temporary outage, duplicate window). */
  get retryable(): boolean {
    return this.status === 429 || this.status === 503 || this.code === 'DuplicateSubmission';
  }
}

export type SubmitResult = {
  /** True when the answer came from the simulator: nothing was sent to ETA and no id in it is a real ETA reference. */
  simulated: boolean;
  submissionUUID: string;
  acceptedDocuments: { uuid: string; longId: string; internalId: string }[];
  rejectedDocuments: { internalId: string; error: { code: string; message: string; target?: string; details?: unknown } }[];
  correlationId: string | null;
};

export type DocumentStatus = 'submitted' | 'valid' | 'invalid' | 'rejected' | 'cancelled';
export type SubmissionStatus = {
  simulated: boolean;
  submissionUUID: string;
  overallStatus: 'in progress' | 'valid' | 'partially valid' | 'invalid';
  documentCount: number;
  documents: { uuid: string; internalId: string; status: DocumentStatus; longId?: string; total?: number }[];
  correlationId: string | null;
};

export interface EtaTransport {
  readonly mode: EtaMode;
  /** `bodyJson` is the exact text from submissionBodyJson (never re-serialized). A 202 means accepted for processing, not valid. */
  submit(bodyJson: string): Promise<SubmitResult>;
  getSubmission(submissionUuid: string, pageNo?: number, pageSize?: number): Promise<SubmissionStatus>;
  cancelDocument(documentUuid: string, reason: string): Promise<{ correlationId: string | null }>;
  rejectDocument(documentUuid: string, reason: string): Promise<{ correlationId: string | null }>;
  getDocumentType(id: number): Promise<unknown>;
}

// ---------------------------------------------------------------- choosing the transport for a company

export type EtaCredentials = { clientId: string; clientSecret: string; onBehalfOf?: string };

/** Thrown when a mode cannot be used. `code` is stable for the API and the tests. */
export class EtaModeError extends Error {
  readonly code: 'INVALID_MODE' | 'CREDENTIALS_MISSING' | 'PRODUCTION_NOT_READY';
  constructor(code: EtaModeError['code'], message: string) {
    super(message);
    this.name = 'EtaModeError';
    this.code = code;
  }
}

export type TransportFactories = {
  simulated: () => EtaTransport;
  real: (environment: 'preprod' | 'production', credentials: EtaCredentials) => EtaTransport;
};

export type TransportRequest = {
  /** The company's saved mode; missing means simulated. */
  mode: string | null | undefined;
  credentials: EtaCredentials | null;
  signer: Signer | null;
};

/**
 * Picks the transport for a company. Never falls back silently: a mode that cannot be honoured throws instead of quietly
 * sending something somewhere else.
 *   simulated  : always allowed, no credentials needed
 *   preprod    : credentials required
 *   production : credentials required AND a signer whose kind is `real` (the stub signer never qualifies)
 */
export function transportFor(req: TransportRequest, factories: TransportFactories): EtaTransport {
  const mode = req.mode ?? DEFAULT_ETA_MODE;
  if (!isEtaMode(mode)) throw new EtaModeError('INVALID_MODE', `Unknown ETA mode "${String(req.mode)}"`);
  if (mode === 'simulated') return factories.simulated();
  const c = req.credentials;
  if (!c || !c.clientId || !c.clientSecret) {
    throw new EtaModeError('CREDENTIALS_MISSING', `${mode} mode needs the company's ETA credentials; none are configured`);
  }
  if (mode === 'production' && (!req.signer || req.signer.kind !== 'real')) {
    throw new EtaModeError('PRODUCTION_NOT_READY', 'Production mode is refused: a real signer (the company certificate) is not configured');
  }
  return factories.real(mode, c);
}
