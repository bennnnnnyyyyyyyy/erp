import type { Role } from '@erp/shared';

export type Bindings = {
  APP_ENV: string;
  ALLOWED_ORIGINS: string;
  /** Workers rate limiting binding (wrangler.toml [[ratelimits]]); absent in tests and local dev. See middleware/rateLimit.ts. */
  API_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_JWKS_URL?: string;
  // WhatsApp (see lib/whatsapp.ts). Secrets: ACCESS_TOKEN, APP_SECRET, VERIFY_TOKEN.
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_GRAPH_VERSION?: string;
  WHATSAPP_TEMPLATE_NAME?: string;
  WHATSAPP_TEMPLATE_LANG?: string;
  // Email (lib/channels/integrations.ts, sql/053). Secret: RESEND_API_KEY. EMAIL_FROM like "ERP <notifications@example.com>" on a
  // domain verified with Resend. Without them, email works in simulated mode only.
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  // Telegram (lib/telegram.ts, sql/054). Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET. TELEGRAM_BOT_USERNAME is the bot's name
  // (for the t.me link). Without them, Telegram works in simulated mode only and linking is unavailable.
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string;
  /** The web app's address, for "Open in the app" buttons (defaults to the first ALLOWED_ORIGINS entry). */
  APP_URL?: string;
};

export type AuthUser = { id: string; email: string };

export type Tenant = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  defaultCurrency: string;
  timezone: string;
  dateFormat: string;
  language: 'en' | 'ar';
  showTutorial: boolean;
  showTour: boolean;
  role: Role;
  permissions: string[];
  modules: string[];
};

export type Variables = {
  user: AuthUser;
  tenant: Tenant;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
