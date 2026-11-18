import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_TEXTS, authErrorMessage } from './authErrors';
import { SCREENS_AR } from './i18nScreens';

describe('sign-in service errors (Codex audit 18 Nov, finding 5)', () => {
  it('maps known codes to our own messages, never the provider text', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('Wrong email or password.');
    expect(authErrorMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toMatch(/^Please confirm your email/);
    expect(authErrorMessage({ code: 'otp_expired' })).toBe('This link has expired. Ask for a new one.');
  });

  it('gives a network message when the server cannot be reached, and a general one for anything else', () => {
    expect(authErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(/^Could not reach the server/);
    expect(authErrorMessage({ code: 'something_new', message: 'Provider wording in English' })).toBe('Something went wrong. Please try again.');
    expect(authErrorMessage(null)).toBe('Something went wrong. Please try again.');
  });

  it('has an Arabic translation for every message it can show', () => {
    expect(AUTH_ERROR_TEXTS.filter((t) => !SCREENS_AR[t])).toEqual([]);
  });
});
