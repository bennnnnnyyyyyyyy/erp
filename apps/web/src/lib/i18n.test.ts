import { describe, expect, it } from 'vitest';
import { planAccountSync } from './i18n';

// The rule for a person's language saved on their account (sql/038): the account wins; a browser-only choice is saved to it once.

describe('planAccountSync', () => {
  it('uses the account language when there is one, and saves nothing', () => {
    expect(planAccountSync('ar', null)).toEqual({ apply: 'ar', push: null });
    expect(planAccountSync('en', 'ar')).toEqual({ apply: 'en', push: null }); // the account beats an older choice in this browser
  });
  it('saves a choice made in this browser when the account has none, and changes nothing here', () => {
    expect(planAccountSync(null, 'ar')).toEqual({ apply: null, push: 'ar' });
    expect(planAccountSync(null, 'en')).toEqual({ apply: null, push: 'en' });
  });
  it('does nothing when neither has a language (the person follows the company default)', () => {
    expect(planAccountSync(null, null)).toEqual({ apply: null, push: null });
  });
});