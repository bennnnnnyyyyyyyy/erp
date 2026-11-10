import { describe, expect, it } from 'vitest';
import {
  BUSINESS_TYPES,
  needsStorage,
  onboardingContent,
  readProgress,
  shouldAutoStart,
  STEP_KEYS,
  stepsFor,
  writeProgress,
} from './onboardingContent';

const en = onboardingContent('en');
const ar = onboardingContent('ar');

/** Every leaf key of an object, functions included, so the two languages must have the same shape. */
function shape(o: unknown, prefix = ''): string[] {
  if (o === null || typeof o !== 'object') return [prefix];
  if (Array.isArray(o)) return [`${prefix}[${o.length}]`];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => shape(v, prefix ? `${prefix}.${k}` : k));
}

describe('onboarding content', () => {
  it('has the same keys, lists and functions in English and Arabic', () => {
    expect(shape(ar)).toEqual(shape(en));
  });

  it('has a title and text for every step, in both languages', () => {
    for (const k of STEP_KEYS) {
      for (const c of [en, ar]) {
        expect(c.steps[k].title.length).toBeGreaterThan(0);
        expect(c.steps[k].body.length).toBeGreaterThan(0);
      }
    }
  });

  it('writes the Arabic in Arabic', () => {
    expect(ar.steps.welcome.body).toMatch(/[؀-ۿ]/);
    expect(ar.stepOf(2, 8)).toContain('2');
    expect(ar.team.invited('a@b.test')).toContain('a@b.test');
  });
});

describe('first-run start', () => {
  const base = { showTutorial: true, canManage: true, warehouses: 0, progress: { step: 0, done: false }, dismissed: false };

  it('starts only in a brand-new company for someone who can manage it', () => {
    expect(shouldAutoStart(base)).toBe(true);
    expect(shouldAutoStart({ ...base, showTutorial: false })).toBe(false);
    expect(shouldAutoStart({ ...base, canManage: false })).toBe(false);
    expect(shouldAutoStart({ ...base, warehouses: 3 })).toBe(false); // a company with data (the sample companies) never starts it
    expect(shouldAutoStart({ ...base, warehouses: null })).toBe(false); // unknown: do not interrupt
  });

  it('never starts again once finished or dismissed', () => {
    expect(shouldAutoStart({ ...base, progress: { step: 7, done: true } })).toBe(false);
    expect(shouldAutoStart({ ...base, dismissed: true })).toBe(false);
  });
});

describe('progress', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('round-trips per company and starts at the beginning when nothing is stored', () => {
    const s = store();
    expect(readProgress('org-a', s)).toEqual({ step: 0, done: false, business: null });
    writeProgress('org-a', { step: 3, done: false, business: 'food' }, s);
    expect(readProgress('org-a', s)).toEqual({ step: 3, done: false, business: 'food' });
    expect(readProgress('org-b', s)).toEqual({ step: 0, done: false, business: null });
  });

  it('ignores damaged or out-of-range values', () => {
    const s = store();
    s.setItem('erp.onboarding.x', 'not json');
    expect(readProgress('x', s)).toEqual({ step: 0, done: false, business: null });
    s.setItem('erp.onboarding.y', JSON.stringify({ step: 99, done: 'yes', business: 'spaceships' }));
    expect(readProgress('y', s)).toEqual({ step: 0, done: false, business: null });
    // a step past the end of the shorter list (no storage step) starts again
    s.setItem('erp.onboarding.z', JSON.stringify({ step: STEP_KEYS.length - 1, done: false, business: 'shop' }));
    expect(readProgress('z', s).step).toBe(0);
  });
});

describe('what do you sell (D9)', () => {
  it('shows the storage step only for food, medicine and cosmetics', () => {
    for (const b of BUSINESS_TYPES) expect(stepsFor(b).includes('storage')).toBe(needsStorage(b));
    expect(BUSINESS_TYPES.filter(needsStorage)).toEqual(['food', 'medicine', 'cosmetics']);
  });
  it('asks the question right after the welcome, and has no language step', () => {
    for (const b of [null, ...BUSINESS_TYPES]) {
      expect(stepsFor(b).slice(0, 2)).toEqual(['welcome', 'business']);
      expect(stepsFor(b) as string[]).not.toContain('language');
    }
  });
  it('has a label, a hint and a unit hint for every business, in both languages', () => {
    for (const c of [en, ar]) {
      for (const b of BUSINESS_TYPES) {
        expect(c.business.options[b].label.length).toBeGreaterThan(0);
        expect(c.business.options[b].hint.length).toBeGreaterThan(0);
        expect(c.business.unitHint[b].length).toBeGreaterThan(0);
      }
    }
  });
});
