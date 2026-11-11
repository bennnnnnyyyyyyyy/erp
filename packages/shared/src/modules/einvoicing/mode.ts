// How a company talks to ETA, and what a "send" is allowed to leave behind. Shared by the API (which builds the record) and the web
// app (which shows the badge). Plan: documentation/plans/ETA_EINVOICING_PLAN.md section 14.
//
//   preprod    (default)  ETA's own test system; needs the company's PreProd credentials
//   production            ETA's live system; refused unless credentials AND a real signer are configured
// sql/082 (Ben, 11 Nov 2026: no test mode on anything): a company can no longer choose our own "simulated" mode. 'simulated' remains
// only as the mode of the in-process stand-in our tests use (apps/api/src/lib/eta/simulated.ts), so the rules below still hold for it:
//
// Rules this file enforces for everything the stand-in "sends":
//   1. it carries the visible badge SIMULATED_BADGE;
//   2. it stores NO real ETA reference (uuid, long id, submission id): those fields are null and the stand-in's own id is kept
//      separately in `simulationId`, so a simulated document can never be mistaken for, or looked up as, a real ETA document.

/** What a company can choose (sql/082). */
export const ETA_MODES = ['preprod', 'production'] as const;
export type EtaCompanyMode = (typeof ETA_MODES)[number];
/** A transport's mode: a company mode, or 'simulated' for the test stand-in only. */
export type EtaMode = EtaCompanyMode | 'simulated';
export const DEFAULT_ETA_MODE: EtaCompanyMode = 'preprod';

/** The exact visible text. English default; the web app shows a translated version through the i18n key below. */
export const SIMULATED_BADGE = 'SIMULATED, not sent to ETA';
export const SIMULATED_BADGE_I18N_KEY = 'einvoicing.simulatedBadge';

/** Every id the stand-in hands out starts with this, so it cannot be confused with an ETA id. */
export const SIMULATION_ID_PREFIX = 'SIMULATED-';

/** True only for a mode a company may choose ('simulated' is not one). */
export const isEtaMode = (v: unknown): v is EtaCompanyMode => typeof v === 'string' && (ETA_MODES as readonly string[]).includes(v);
export const isSimulationId = (id: string): boolean => id.startsWith(SIMULATION_ID_PREFIX);

/** What we store for one document after a send. */
export type EtaSendRecord = {
  mode: EtaMode;
  simulated: boolean;
  /** SIMULATED_BADGE for simulated sends, otherwise null. */
  badge: string | null;
  internalId: string;
  /** Real ETA references. ALWAYS null when simulated. */
  etaUuid: string | null;
  etaLongId: string | null;
  etaSubmissionUuid: string | null;
  /** The stand-in's own id, only when simulated. */
  simulationId: string | null;
};

export type SentDocument = { uuid: string; longId: string; internalId: string };

/** Builds the record to store. In simulated mode the ETA reference fields are dropped, whatever the result contained. */
export function toSendRecord(mode: EtaMode, submissionUuid: string, doc: SentDocument): EtaSendRecord {
  if (mode === 'simulated') {
    return {
      mode,
      simulated: true,
      badge: SIMULATED_BADGE,
      internalId: doc.internalId,
      etaUuid: null,
      etaLongId: null,
      etaSubmissionUuid: null,
      simulationId: doc.uuid,
    };
  }
  if (isSimulationId(doc.uuid) || isSimulationId(submissionUuid)) {
    throw new Error('SIMULATED_ID_IN_REAL_MODE: a simulated id must never be stored as an ETA reference');
  }
  return {
    mode,
    simulated: false,
    badge: null,
    internalId: doc.internalId,
    etaUuid: doc.uuid,
    etaLongId: doc.longId,
    etaSubmissionUuid: submissionUuid,
    simulationId: null,
  };
}

/** The badge to show for a stored record (null when it was really sent). */
export function badgeFor(record: Pick<EtaSendRecord, 'simulated'>): string | null {
  return record.simulated ? SIMULATED_BADGE : null;
}

/** True when a stored record obeys the rules above. Used by tests and by any future database check. */
export function recordIsConsistent(r: EtaSendRecord): boolean {
  if (r.simulated) {
    return (
      r.mode === 'simulated' &&
      r.badge === SIMULATED_BADGE &&
      r.etaUuid === null &&
      r.etaLongId === null &&
      r.etaSubmissionUuid === null &&
      r.simulationId !== null
    );
  }
  return r.mode !== 'simulated' && r.badge === null && r.simulationId === null && r.etaUuid !== null && !isSimulationId(r.etaUuid);
}
