import { tr } from './i18n';

// Codex audit 18 Nov, finding 5: sign-in, sign-up, password reset, set password and the company picker showed the sign-in service's
// own message (English, provider wording) on Arabic screens. Its stable error codes become our own messages, in the person's language;
// anything else gets a general message. The provider's text is never shown.
const BY_CODE: Record<string, string> = {
  invalid_credentials: 'Wrong email or password.',
  invalid_grant: 'Wrong email or password.',
  email_not_confirmed: 'Please confirm your email first: open the link we sent you.',
  user_already_exists: 'An account with this email already exists. Sign in instead, or reset the password.',
  email_exists: 'An account with this email already exists. Sign in instead, or reset the password.',
  weak_password: 'Choose a stronger password: at least 8 characters, not easy to guess.',
  same_password: 'The new password must be different from the old one.',
  over_request_rate_limit: 'Too many attempts. Wait a few minutes and try again.',
  over_email_send_rate_limit: 'Too many emails sent. Wait a few minutes and try again.',
  otp_expired: 'This link has expired. Ask for a new one.',
  email_address_invalid: 'That email address is not valid.',
  validation_failed: 'Please check what you typed and try again.',
  session_not_found: 'Your session has ended. Please sign in again.',
};

const GENERAL = 'Something went wrong. Please try again.';
const NETWORK = 'Could not reach the server. Check your connection and try again.';

/** The message to show for an error from the sign-in service (or a database call made directly from the browser). */
export function authErrorMessage(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; name?: unknown; status?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  if (code && BY_CODE[code]) return tr(BY_CODE[code]);
  if (e.name === 'AuthRetryableFetchError' || e.status === 0) return tr(NETWORK);
  return tr(GENERAL);
}

/** For tests: every English text this file can show, so each must have an Arabic translation. */
export const AUTH_ERROR_TEXTS = [...new Set([...Object.values(BY_CODE), GENERAL, NETWORK])];
