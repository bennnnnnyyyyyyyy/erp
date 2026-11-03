// When App.tsx loads the session (who you are, your company, your permissions). Supabase fires an auth event, with a NEW session
// object, every time it renews the sign-in token and every time the tab regains focus. Reloading on each of those blanked the whole app
// and reloaded every list (the "refresh every few seconds"). So the reload is keyed on WHO is signed in and WHICH company is open:
// the same person in the same company is the same key, however many times the token is renewed.

/** The reload key, or null when nobody is signed in or no company is chosen. */
export function sessionKey(userId: string | null | undefined, orgId: string | null | undefined): string | null {
  return userId && orgId ? `${userId}:${orgId}` : null;
}

/**
 * What to do with the session already on screen when (re)loading for `next`:
 * - 'none'    nobody signed in or no company: show nothing;
 * - 'clear'   another person or company: blank the screen first, so nothing of the previous one is shown;
 * - 'refresh' the same person and company (a screen asked to reload): keep the screen and swap the data in.
 */
export function reloadMode(loadedFor: string | null, next: string | null): 'none' | 'clear' | 'refresh' {
  if (!next) return 'none';
  return loadedFor === next ? 'refresh' : 'clear';
}
