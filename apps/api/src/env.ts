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
