// Integrations, wave 1 (documentation/plans/INTEGRATIONS_PLAN.md; database sql/053). Shapes shared by the API and the web app.

export const INTEGRATION_KINDS = ['email', 'slack', 'teams', 'telegram'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

/** Outbox message kinds a company may route to an integration (sql/053 core__integration_kinds). */
export const INTEGRATION_MESSAGE_KINDS = [
  'approval_request',
  'decision',
  'task_assigned',
  'reminder',
  'escalation',
  'alert',
  'info',
] as const;
export type IntegrationMessageKind = (typeof INTEGRATION_MESSAGE_KINDS)[number];

export type IntegrationSettings = {
  kind: IntegrationKind;
  enabled: boolean;
  /** simulated: nothing leaves the system (the default); live: really sent. */
  mode: 'simulated' | 'live';
  messageKinds: string[];
  /** The end of the saved webhook URL, never the URL itself. */
  secretHint: string | null;
  needsSecret: boolean;
  /** Whether live mode can work now (email: our sending account is set up; Slack/Teams: a URL is saved). */
  liveAvailable: boolean;
  lastStatus: 'sent' | 'failed' | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
};

export type FxRate = { from: string; to: string; rate: number; rateDate: string; source: string };
