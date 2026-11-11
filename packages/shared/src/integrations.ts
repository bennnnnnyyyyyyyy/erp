// Integrations, wave 1 (documentation/plans/INTEGRATIONS_PLAN.md; database sql/053). Shapes shared by the API and the web app.

export const INTEGRATION_KINDS = ['email', 'slack', 'teams', 'telegram', 'google_chat'] as const;
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

/** Private read-only report links for Google Sheets (sql/070). */
export const REPORT_LINK_KINDS = ['stock_on_hand', 'open_invoices', 'sales_by_month'] as const;
export type ReportLinkKind = (typeof REPORT_LINK_KINDS)[number];

/** A link as listed: never the token (only its hash is stored). */
export type ReportLink = {
  id: string;
  report: ReportLinkKind;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastReadAt: string | null;
  readCount: number;
};

/** Answer to creating a link: the only time the token and the address are shown. */
export type ReportLinkCreated = { id: string; token: string; url: string; formula: string };

export type IntegrationSettings = {
  kind: IntegrationKind;
  /** On means real: there is no test mode (sql/082). */
  enabled: boolean;
  messageKinds: string[];
  /** The end of the saved webhook URL, never the URL itself. */
  secretHint: string | null;
  needsSecret: boolean;
  /** Whether it can be switched on now (email, Telegram: our server account is set up; Slack, Teams, Google Chat: a URL is saved). */
  ready: boolean;
  lastStatus: 'sent' | 'failed' | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
};

export type FxRate = { from: string; to: string; rate: number; rateDate: string; source: string };

/** "Check connection" (sql/082): one real, harmless call to the provider with the saved details, and what came back. */
export type IntegrationCheck = {
  ok: boolean;
  /** Short, plain answer for the screen (the provider's own words when it refused). Never a key. */
  message: string;
  /** Something to open, when the check made one: Paymob's checkout page for a small unpaid test payment. */
  url?: string;
};

// ------------------------------------------------------------------ providers (sql/056; Ben's choices, 6 Nov)

export const PROVIDER_KINDS = ['paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type ProviderGroup = 'payments' | 'shipping' | 'store' | 'ai';

export type ProviderField = {
  key: string;
  label: string;
  /** Stored write-only in the vault; never shown again once saved. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
};

export type ProviderDef = {
  kind: ProviderKind;
  group: ProviderGroup;
  name: string;
  summary: string;
  fields: ProviderField[];
  webhookPath?: string;
};

/** The same fields as sql/056 core__provider_fields; labels and help for the settings screen. */
export const PROVIDERS: readonly ProviderDef[] = [
  {
    kind: 'paymob',
    group: 'payments',
    name: 'Paymob',
    summary: 'Card, wallet and instalment payments through a "Pay now" link on each sales invoice.',
    webhookPath: '/webhooks/paymob',
    fields: [
      { key: 'secret_key', label: 'Secret key', secret: true, required: true, placeholder: 'egy_sk_…' },
      { key: 'public_key', label: 'Public key', secret: true, required: true, placeholder: 'egy_pk_…' },
      { key: 'hmac_secret', label: 'HMAC secret', secret: true, required: true, help: 'Paymob dashboard → Settings → Account info.' },
      {
        key: 'integration_ids',
        label: 'Payment method IDs',
        secret: false,
        required: true,
        placeholder: '4001,4002',
        help: 'The integration IDs of the methods to offer, comma-separated.',
      },
    ],
  },
  {
    kind: 'fawry',
    group: 'payments',
    name: 'Fawry',
    summary: 'Payment by Fawry reference number at any Fawry outlet, or by card, for each sales invoice.',
    webhookPath: '/webhooks/fawry',
    fields: [
      { key: 'merchant_code', label: 'Merchant code', secret: false, required: true },
      { key: 'secure_key', label: 'Security key', secret: true, required: true },
    ],
  },
  {
    kind: 'bosta',
    group: 'shipping',
    name: 'Bosta',
    summary: 'Create a Bosta delivery from a sales order and follow its status here.',
    webhookPath: '/webhooks/bosta',
    fields: [
      { key: 'api_key', label: 'API key', secret: true, required: true, help: 'Bosta → Settings → API Integration (read/write).' },
      {
        key: 'webhook_secret',
        label: 'Webhook secret',
        secret: true,
        required: true,
        help: "Any long random text. Enter the same text in Bosta as the webhook's Authorization header.",
      },
    ],
  },
  {
    kind: 'shopify',
    group: 'store',
    name: 'Shopify',
    summary: 'Shopify orders arrive here as sales orders (matched by SKU) and go through the normal stock approval.',
    webhookPath: '/webhooks/shopify',
    fields: [
      { key: 'shop_domain', label: 'Shop domain', secret: false, required: true, placeholder: 'your-store.myshopify.com' },
      {
        key: 'client_id',
        label: 'Client ID',
        secret: false,
        required: true,
        help: "Your app in Shopify's Dev Dashboard → Settings. Since 2026 there is no permanent token: we ask Shopify for a new one when needed.",
      },
      { key: 'webhook_secret', label: 'Client secret (also signs webhooks)', secret: true, required: true },
      {
        key: 'access_token',
        label: 'Admin API access token (only apps made before 2026)',
        secret: true,
        required: false,
        placeholder: 'shpat_…',
        help: 'Leave empty for a new app.',
      },
      {
        key: 'warehouse_code',
        label: 'Warehouse code for store orders (optional)',
        secret: false,
        required: false,
        placeholder: 'MAIN',
        help: 'Leave empty to use your oldest warehouse.',
      },
    ],
  },
  {
    kind: 'openai',
    group: 'ai',
    name: 'OpenAI',
    summary: "The assistant and voice transcription. Needs the owner's consent: company data is sent to OpenAI.",
    fields: [
      {
        key: 'api_key',
        label: 'Your own API key (optional)',
        secret: true,
        required: false,
        help: 'Leave empty to use ours, within the monthly limit.',
      },
      { key: 'model', label: 'Model (optional)', secret: false, required: false, placeholder: 'gpt-5-mini' },
    ],
  },
  {
    kind: 'elevenlabs',
    group: 'ai',
    name: 'ElevenLabs',
    summary: "Voice transcription (Arabic supported). Needs the owner's consent: recordings are sent to ElevenLabs.",
    fields: [
      {
        key: 'api_key',
        label: 'Your own API key (optional)',
        secret: true,
        required: false,
        help: 'Leave empty to use ours, within the monthly limit.',
      },
    ],
  },
  {
    kind: 'ollama',
    group: 'ai',
    name: 'Ollama (your own AI)',
    summary:
      'Run the assistant on your own server, reached by our servers over the internet at the https address you enter. Nothing is charged.',
    fields: [
      {
        key: 'base_url',
        label: 'Ollama address',
        secret: false,
        required: true,
        placeholder: 'https://ai.your-company.com',
        help: 'Must be reachable from the internet over https (for example through a tunnel).',
      },
      { key: 'model', label: 'Model', secret: false, required: true, placeholder: 'qwen2.5:7b' },
      { key: 'api_key', label: 'Access key (optional)', secret: true, required: false, help: 'If your address is protected by a key.' },
    ],
  },
];

export const findProvider = (kind: string) => PROVIDERS.find((p) => p.kind === kind);

export type ProviderSettings = {
  kind: ProviderKind;
  /** On means real: there is no test mode (sql/082). */
  enabled: boolean;
  /** Every required field is saved, so it can be switched on. */
  ready: boolean;
  /** The full address to give the provider for its callbacks (this API's address plus webhookPath), when it has one. */
  callbackUrl: string | null;
  /** Names of saved fields (secret or plain); values of secret fields are never returned. */
  savedFields: string[];
  /** Plain (non-secret) values, for showing and editing. */
  config: Record<string, string>;
  lastStatus: 'sent' | 'failed' | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
};

export type AiStatus = {
  consent: { version: string; acceptedBy: string; acceptedAt: string } | null;
  monthCalls: number;
  monthSpendMicroUsd: number;
  /** Our monthly cap across all companies on our keys (USD). */
  serviceCapUsd: number;
  ownProviderReady: { openai: boolean; elevenlabs: boolean };
};

/**
 * The notice the owner accepts before company data may go to any AI provider (versioned; changing it asks again).
 * v2 (sql/061, 6 Nov 2026): the notice covers Ollama, which reaches the company's server over the internet.
 * Must equal core__ai_notice_version() in the database: the database refuses any other version, and only consent to its version counts.
 */
export const AI_NOTICE_VERSION = 'v2';
