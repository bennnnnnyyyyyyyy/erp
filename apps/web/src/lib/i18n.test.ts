import { describe, expect, it } from 'vitest';
import { planAccountSync } from './i18n';

// The rule for a person's language saved on their account (sql/038). Arguments: account language, account has a row, browser language,
// browser already asked.

describe('planAccountSync', () => {
  it('1. uses the account language when there is one, saves nothing, and counts as asked', () => {
    expect(planAccountSync('ar', true, null, false)).toEqual({ lang: 'ar', push: null, asked: true });
    expect(planAccountSync('en', true, 'ar', true)).toEqual({ lang: 'en', push: null, asked: true }); // the account beats an older browser choice
  });
  it('2. follows the company when the account says "company default", and does not ask again', () => {
    expect(planAccountSync(null, true, null, false)).toEqual({ lang: null, push: null, asked: true });
    expect(planAccountSync(null, true, 'ar', true)).toEqual({ lang: null, push: null, asked: true });
  });
  it('3. saves a browser-only choice to the account and keeps it here', () => {
    expect(planAccountSync(null, false, 'ar', true)).toEqual({ lang: 'keep', push: { value: 'ar' }, asked: true });
    expect(planAccountSync(null, false, 'en', false)).toEqual({ lang: 'keep', push: { value: 'en' }, asked: true });
  });
  it('4. saves "company default" when this browser already asked and nothing was chosen, so other devices do not ask again', () => {
    expect(planAccountSync(null, false, null, true)).toEqual({ lang: 'keep', push: { value: null }, asked: true });
  });
  it('5. does nothing, and has not asked, when there is no language anywhere and nobody asked: the first-run prompt will', () => {
    expect(planAccountSync(null, false, null, false)).toEqual({ lang: 'keep', push: null, asked: false });
  });
  it('never saves something to the account when the account already has an answer', () => {
    for (const local of ['ar', 'en', null] as const) {
      for (const localAsked of [true, false]) {
        expect(planAccountSync('ar', true, local, localAsked).push).toBeNull();
        expect(planAccountSync(null, true, local, localAsked).push).toBeNull();
      }
    }
  });
});