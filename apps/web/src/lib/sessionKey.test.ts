import { describe, expect, it } from 'vitest';
import { reloadMode, sessionKey } from './sessionKey';

// The session reload in App.tsx re-runs only when its dependencies [sessionKey, sessionTick] change (React compares them with
// Object.is). These tests replay what Supabase sends and count how often the session would reload and whether the screen blanks.

type AuthEvent = { user: { id: string }; access_token: string } | null;

/** Replays events the way React does for `useEffect(..., [key, tick])`: the effect runs when either value differs from last time. */
function replay(steps: { auth: AuthEvent; orgId: string | null; tick?: number }[]) {
  let prev: [string | null, number] | undefined;
  let loadedFor: string | null = null;
  const runs: ('none' | 'clear' | 'refresh')[] = [];
  for (const s of steps) {
    const deps: [string | null, number] = [sessionKey(s.auth?.user.id, s.orgId), s.tick ?? 0];
    if (prev && Object.is(prev[0], deps[0]) && Object.is(prev[1], deps[1])) continue;
    prev = deps;
    const mode = reloadMode(loadedFor, deps[0]);
    runs.push(mode);
    if (mode !== 'none') loadedFor = deps[0];   // the load succeeds
  }
  return runs;
}

const chris = (token: string): AuthEvent => ({ user: { id: 'u-chris' }, access_token: token });

describe('session reload (App.tsx)', () => {
  it('keys on the person and the company only', () => {
    expect(sessionKey('u1', 'o1')).toBe('u1:o1');
    expect(sessionKey('u1', 'o1')).toBe(sessionKey('u1', 'o1'));
    expect(sessionKey(undefined, 'o1')).toBeNull();
    expect(sessionKey('u1', null)).toBeNull();
  });

  it('does not reload when the token is renewed or the tab regains focus', () => {
    // Sign-in, then four auth events for the same person (TOKEN_REFRESHED, SIGNED_IN on focus...): each is a new object and token.
    const runs = replay([
      { auth: chris('t1'), orgId: 'o1' },
      { auth: chris('t2'), orgId: 'o1' },
      { auth: chris('t3'), orgId: 'o1' },
      { auth: chris('t3'), orgId: 'o1' },
      { auth: chris('t4'), orgId: 'o1' },
    ]);
    expect(runs).toEqual(['clear']);   // loaded once, at sign-in; never again
  });

  it('reloads, with a blank screen, when the company or the person changes', () => {
    const runs = replay([
      { auth: chris('t1'), orgId: 'o1' },
      { auth: chris('t2'), orgId: 'o2' },                                       // switched company
      { auth: { user: { id: 'u-grant' }, access_token: 't9' }, orgId: 'o2' },   // someone else signed in
    ]);
    expect(runs).toEqual(['clear', 'clear', 'clear']);
  });

  it('reloads in place, keeping the screen, when a screen asks for it', () => {
    const runs = replay([
      { auth: chris('t1'), orgId: 'o1', tick: 0 },
      { auth: chris('t2'), orgId: 'o1', tick: 0 },   // token renewed: nothing
      { auth: chris('t2'), orgId: 'o1', tick: 1 },   // Settings saved: reload, same person and company
    ]);
    expect(runs).toEqual(['clear', 'refresh']);
  });

  it('shows nothing once signed out or with no company chosen', () => {
    expect(replay([{ auth: chris('t1'), orgId: 'o1' }, { auth: null, orgId: 'o1' }])).toEqual(['clear', 'none']);
    expect(reloadMode('u1:o1', null)).toBe('none');
  });
});
