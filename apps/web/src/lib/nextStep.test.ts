import { describe, expect, it } from 'vitest';
import { AUDIT_AR } from './i18nAudit';
import { DECISIONS_AR } from './i18nDecisions';
import { ERRORS_AR } from './i18nErrors';
import { MASTER_DATA_AR } from './i18nMasterData';
import { NAV_AR } from './i18nNav';
import { PEOPLE_AR } from './i18nPeople';
import { PRINTING_AR } from './i18nPrinting';
import { REPORTS_AR } from './i18nReports';
import { SCANNING_AR } from './i18nScanning';
import { SCREENS_AR } from './i18nScreens';
import { UX_AUDIT_AR } from './i18nUxAudit';
import { NEXT_STEPS, nextStepFor } from './nextStep';

const AR = { ...NAV_AR, ...SCREENS_AR, ...AUDIT_AR, ...ERRORS_AR, ...UX_AUDIT_AR, ...DECISIONS_AR, ...MASTER_DATA_AR, ...PEOPLE_AR, ...PRINTING_AR, ...SCANNING_AR, ...REPORTS_AR } as Record<string, string>;

describe('what to do when an action is blocked', () => {
  it('every step has Arabic for its sentence and its page name, and a link is an app page', () => {
    for (const [code, s] of Object.entries(NEXT_STEPS)) {
      expect(AR[s.text], `${code}: ${s.text}`).toBeTruthy();
      if (s.label) expect(AR[s.label], `${code}: ${s.label}`).toBeTruthy();
      if (s.to) expect(s.to, code).toMatch(/^\/[a-z]/);
      expect(!!s.to, code).toBe(!!s.label);
    }
  });

  it('finds the step for a code, and nothing for an unknown one', () => {
    expect(nextStepFor('period_locked')?.to).toBe('/settings');
    expect(nextStepFor('insufficient_available')?.to).toBe('/inventory/receive');
    expect(nextStepFor('nothing_like_this')).toBeUndefined();
    expect(nextStepFor(undefined)).toBeUndefined();
  });
});
