// The stand-in for ETA. It answers the way the documented ETA API does (202 with accepted and rejected documents, an asynchronous
// status that starts "in progress", cancel and reject rules, the 10-minute duplicate rule) and sends NOTHING anywhere. It makes no
// network call and imports no HTTP client.
//
// Everything it hands out is visibly fake: ids start with SIMULATED- (SIMULATION_ID_PREFIX), results carry `simulated: true`, and
// toSendRecord() in @erp/shared stores no real ETA reference for them. The same contract test that runs against ETA PreProd runs
// against this class, so the two cannot drift apart without a test noticing.
//
// Scenarios (per document, by default "accepted"):
//   accepted : the document is accepted and becomes valid on the first status check
//   rejected : the document is refused at submission (rejectedDocuments), like a structure or validation failure
//   pending  : accepted but "in progress" for `pendingPolls` status checks (default 1), then valid

import { SIMULATION_ID_PREFIX, parseDoc, type DocObject } from '@erp/shared';
import { EtaError, type DocumentStatus, type EtaTransport, type SubmissionStatus, type SubmitResult } from './transport';

export type SimulatedScenario = 'accepted' | 'rejected' | 'pending';

export type SimulatedOptions = {
  /** One scenario for every document, or a function of the document's internalID (our document number). */
  scenario?: SimulatedScenario | ((internalId: string) => SimulatedScenario);
  /** For `pending`: how many status checks answer "in progress" before the document turns valid. */
  pendingPolls?: number;
  /** Milliseconds since epoch; injectable for tests (only the duplicate window uses it). */
  now?: () => number;
  /** ETA treats an identical payload from the same taxpayer within this many seconds as a duplicate (official: 10 minutes). */
  duplicateWindowSeconds?: number;
};

type SimDoc = { uuid: string; longId: string; internalId: string; submissionUuid: string; status: DocumentStatus };
type SimSubmission = { uuid: string; docs: string[]; pollsLeft: number };

const ID_RE = /^[A-Za-z0-9-]{10,40}$/;

export class SimulatedTransport implements EtaTransport {
  readonly mode = 'simulated' as const;
  private readonly opts: SimulatedOptions;
  private counter = 0;
  private readonly submissions = new Map<string, SimSubmission>();
  private readonly docs = new Map<string, SimDoc>();
  private readonly seen = new Map<string, number>();

  constructor(options: SimulatedOptions = {}) {
    this.opts = options;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }
  private next(kind: string): string {
    this.counter += 1;
    return `${SIMULATION_ID_PREFIX}${kind}-${String(this.counter).padStart(4, '0')}`;
  }
  private scenarioFor(internalId: string): SimulatedScenario {
    const s = this.opts.scenario ?? 'accepted';
    return typeof s === 'function' ? s(internalId) : s;
  }
  private corr(): string {
    return this.next('CORR');
  }

  async submit(bodyJson: string): Promise<SubmitResult> {
    let parsed: unknown;
    try {
      parsed = parseDoc(bodyJson);
    } catch {
      throw new EtaError(400, 'BadStructure', 'The submission is not valid JSON', this.corr(), null);
    }
    const documents = (parsed as DocObject | null)?.documents;
    if (!Array.isArray(documents) || documents.length === 0 || documents.some((d) => !d || typeof d !== 'object' || Array.isArray(d))) {
      throw new EtaError(
        400,
        'BadStructure',
        'The submission must be { "documents": [ ... ] } with at least one document',
        this.corr(),
        null,
      );
    }

    // Official rule: an identical payload from the same taxpayer within 10 minutes is a duplicate (422, Retry-After).
    const window = (this.opts.duplicateWindowSeconds ?? 600) * 1000;
    const firstSeen = this.seen.get(bodyJson);
    if (firstSeen !== undefined && this.now() - firstSeen < window) {
      throw new EtaError(
        422,
        'DuplicateSubmission',
        'An identical submission was received in the last 10 minutes',
        this.corr(),
        Math.ceil((window - (this.now() - firstSeen)) / 1000),
      );
    }
    this.seen.set(bodyJson, this.now());

    const submissionUuid = this.next('SUB');
    const acceptedDocuments: SubmitResult['acceptedDocuments'] = [];
    const rejectedDocuments: SubmitResult['rejectedDocuments'] = [];
    const sub: SimSubmission = { uuid: submissionUuid, docs: [], pollsLeft: 0 };
    for (const d of documents as DocObject[]) {
      const idv = d.internalID ?? d.internalId;
      const internalId = typeof idv === 'string' ? idv : '';
      if (!internalId) {
        rejectedDocuments.push({
          internalId: '',
          error: { code: 'BadStructure', message: 'The document has no internalID', target: 'internalID' },
        });
        continue;
      }
      const scenario = this.scenarioFor(internalId);
      if (scenario === 'rejected') {
        rejectedDocuments.push({
          internalId,
          error: { code: 'SimulatedRejection', message: 'Simulated rejection (scenario "rejected")', target: internalId },
        });
        continue;
      }
      const doc: SimDoc = {
        uuid: this.next('DOC'),
        longId: this.next('LONG'),
        internalId,
        submissionUuid,
        status: scenario === 'pending' ? 'submitted' : 'valid',
      };
      this.docs.set(doc.uuid, doc);
      sub.docs.push(doc.uuid);
      if (scenario === 'pending') sub.pollsLeft = Math.max(sub.pollsLeft, this.opts.pendingPolls ?? 1);
      acceptedDocuments.push({ uuid: doc.uuid, longId: doc.longId, internalId });
    }
    this.submissions.set(submissionUuid, sub);
    return { simulated: true, submissionUUID: submissionUuid, acceptedDocuments, rejectedDocuments, correlationId: this.corr() };
  }

  async getSubmission(submissionUuid: string): Promise<SubmissionStatus> {
    if (!ID_RE.test(submissionUuid)) throw new Error('INVALID_SUBMISSION_UUID');
    const sub = this.submissions.get(submissionUuid);
    if (!sub) throw new EtaError(404, 'NotFound', 'Submission not found', this.corr(), null);
    const inProgress = sub.pollsLeft > 0;
    if (inProgress) {
      sub.pollsLeft -= 1;
    } else {
      for (const u of sub.docs) {
        const d = this.docs.get(u);
        if (d && d.status === 'submitted') d.status = 'valid';
      }
    }
    const docs = sub.docs.map((u) => this.docs.get(u) as SimDoc);
    const statuses = docs.map((d) => d.status);
    const overall: SubmissionStatus['overallStatus'] =
      docs.length === 0
        ? 'invalid'
        : inProgress && statuses.includes('submitted')
          ? 'in progress'
          : statuses.every((s) => s === 'invalid')
            ? 'invalid'
            : statuses.some((s) => s === 'invalid')
              ? 'partially valid'
              : 'valid';
    return {
      simulated: true,
      submissionUUID: sub.uuid,
      overallStatus: overall,
      documentCount: docs.length,
      documents: docs.map((d) => ({
        uuid: d.uuid,
        internalId: d.internalId,
        status: inProgress && d.status === 'submitted' ? 'submitted' : d.status,
        longId: d.longId,
      })),
      correlationId: this.corr(),
    };
  }

  private async setState(documentUuid: string, to: 'cancelled' | 'rejected', reason: string): Promise<{ correlationId: string | null }> {
    if (!ID_RE.test(documentUuid)) throw new Error('INVALID_DOCUMENT_UUID');
    if (!reason.trim()) throw new Error('REASON_REQUIRED');
    const d = this.docs.get(documentUuid);
    if (!d) throw new EtaError(404, 'NotFound', 'Document not found', this.corr(), null);
    if (d.status !== 'valid')
      throw new EtaError(400, 'IncorrectState', `A document that is ${d.status} cannot be ${to}`, this.corr(), null);
    d.status = to;
    return { correlationId: this.corr() };
  }
  cancelDocument(documentUuid: string, reason: string) {
    return this.setState(documentUuid, 'cancelled', reason);
  }
  rejectDocument(documentUuid: string, reason: string) {
    return this.setState(documentUuid, 'rejected', reason);
  }

  async getDocumentType(id: number): Promise<unknown> {
    // The real answer carries the cancel and reject windows as workflow parameters; their names are not published, so none are invented.
    return { id, simulated: true, workflowParameters: [] };
  }
}
