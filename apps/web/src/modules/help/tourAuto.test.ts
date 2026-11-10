import { describe, expect, it } from 'vitest';
import { markTourSeen, shouldAutoStartTour, tourSeen, tourSeenKey } from './tourAuto';

const base = { showTour: true, userId: 'u1', orgId: 'o1', seen: false, stepCount: 5, onSetupWizard: false, demo: false };

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('shouldAutoStartTour', () => {
  it('starts for a person who has not seen it when the company switched it on', () => {
    expect(shouldAutoStartTour(base)).toBe(true);
  });
  it('does nothing while the company switch is off (the default)', () => {
    expect(shouldAutoStartTour({ ...base, showTour: false })).toBe(false);
  });
  it('shows once per person', () => {
    expect(shouldAutoStartTour({ ...base, seen: true })).toBe(false);
  });
  it('does not start with no usable steps, in the setup wizard, in the sample build, or without a person and company', () => {
    expect(shouldAutoStartTour({ ...base, stepCount: 0 })).toBe(false);
    expect(shouldAutoStartTour({ ...base, onSetupWizard: true })).toBe(false);
    expect(shouldAutoStartTour({ ...base, demo: true })).toBe(false);
    expect(shouldAutoStartTour({ ...base, userId: null })).toBe(false);
    expect(shouldAutoStartTour({ ...base, orgId: null })).toBe(false);
  });
});

describe('remembering the tour was shown', () => {
  it('is per person and per company', () => {
    const s = memory();
    expect(tourSeen('u1', 'o1', s)).toBe(false);
    markTourSeen('u1', 'o1', s);
    expect(tourSeen('u1', 'o1', s)).toBe(true);
    expect(tourSeen('u2', 'o1', s)).toBe(false);
    expect(tourSeen('u1', 'o2', s)).toBe(false);
    expect(tourSeenKey('u1', 'o1')).not.toBe(tourSeenKey('u1', 'o2'));
  });
  it('survives storage that throws', () => {
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(tourSeen('u1', 'o1', bad)).toBe(false);
    expect(() => markTourSeen('u1', 'o1', bad)).not.toThrow();
  });
});
