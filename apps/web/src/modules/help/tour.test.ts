import { describe, expect, it } from 'vitest';
import { defaultPermissionsFor } from '@erp/shared';
import { tourContent } from './tourContent';
import { TOUR_STEPS, placeTooltip, stepsFor } from './tourSteps';

const ALL_MODULES = ['inventory', 'finance', 'alerts', 'sales', 'purchasing', 'tasks', 'messaging'];
const ids = (role: 'owner' | 'admin' | 'member' | 'viewer', modules = ALL_MODULES) => stepsFor({ permissions: defaultPermissionsFor(role), modules }).map((s) => s.id);

describe('who sees which step', () => {
  it('gives an admin the whole tour', () => {
    expect(ids('admin')).toEqual(['home', 'new-request', 'approve', 'ledger', 'audit', 'alerts', 'guide']);
  });
  it('gives staff the stock steps and the audit log (any member may read it) but no finance home or alerts', () => {
    expect(ids('member')).toEqual(['new-request', 'approve', 'ledger', 'audit', 'guide']);
  });
  it('gives a viewer only what they can look at: no request form', () => {
    const v = ids('viewer');
    expect(v).not.toContain('new-request');
    expect(v).toEqual(expect.arrayContaining(['approve', 'ledger', 'guide']));
  });
  it('drops a step whose module is switched off, even for an admin', () => {
    expect(ids('admin', ['inventory'])).toEqual(['new-request', 'approve', 'ledger', 'audit', 'guide']);
    expect(ids('admin', [])).toEqual(['audit', 'guide']);
  });
  it('always ends with the Guide, so every tour has somewhere to finish', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) expect(ids(role).at(-1)).toBe('guide');
  });
  it('every step has a route and at least one selector, and the last selector is a heading fallback', () => {
    for (const s of TOUR_STEPS) {
      expect(s.route.startsWith('/')).toBe(true);
      expect(s.selectors.length).toBeGreaterThan(0);
      expect(s.selectors.at(-1)).toMatch(/h1$/);
    }
  });
});

describe('tooltip placement', () => {
  const vp = { width: 1000, height: 700 };
  const tip = { width: 360, height: 200 };
  it('goes below the target when there is room, centred on it', () => {
    const p = placeTooltip({ top: 100, left: 400, width: 200, height: 50 }, tip, vp);
    expect(p).toEqual({ top: 162, left: 320, placement: 'below' });
  });
  it('goes above when there is no room below', () => {
    const p = placeTooltip({ top: 560, left: 400, width: 200, height: 100 }, tip, vp);
    expect(p.placement).toBe('above');
    expect(p.top + tip.height).toBeLessThanOrEqual(560);
  });
  it('goes beside a target that is too tall to sit above or below, on the side with room, without covering it', () => {
    const right = placeTooltip({ top: 100, left: 100, width: 400, height: 600 }, tip, vp);
    expect(right.placement).toBe('beside');
    expect(right.left).toBeGreaterThanOrEqual(100 + 400);
    const left = placeTooltip({ top: 100, left: 520, width: 400, height: 600 }, tip, vp);
    expect(left.placement).toBe('beside');
    expect(left.left + tip.width).toBeLessThanOrEqual(520);
    expect(left.top).toBeGreaterThanOrEqual(8);
    expect(left.top + tip.height).toBeLessThanOrEqual(vp.height);
  });
  it('is pinned to the bottom of the screen only when a target fills the screen', () => {
    const p = placeTooltip({ top: 0, left: 100, width: 800, height: 700 }, tip, vp);
    expect(p.placement).toBe('pinned');
    expect(p.top + tip.height).toBeLessThanOrEqual(vp.height);
  });
  it('stays fully on screen at either edge, so left-to-right and right-to-left behave the same', () => {
    const atStart = placeTooltip({ top: 100, left: 0, width: 40, height: 40 }, tip, vp);
    const atEnd = placeTooltip({ top: 100, left: 960, width: 40, height: 40 }, tip, vp);
    expect(atStart.left).toBeGreaterThanOrEqual(8);
    expect(atEnd.left + tip.width).toBeLessThanOrEqual(vp.width - 8);
  });
  it('fits a phone-width screen', () => {
    const phone = { width: 390, height: 780 };
    const p = placeTooltip({ top: 300, left: 20, width: 350, height: 60 }, { width: 374, height: 220 }, phone);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 374).toBeLessThanOrEqual(phone.width - 8 + 0.001);
  });
});

describe('tour content', () => {
  const en = tourContent('en');
  const ar = tourContent('ar');
  const ARABIC = /[؀-ۿ]/;
  it('has text for every step in both languages', () => {
    for (const s of TOUR_STEPS) {
      for (const c of [en, ar]) {
        expect(c.steps[s.id]?.title.trim().length).toBeGreaterThan(0);
        expect(c.steps[s.id]?.body.trim().length).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(ar.steps).sort()).toEqual(Object.keys(en.steps).sort());
  });
  it('Arabic is Arabic and English is not', () => {
    for (const s of TOUR_STEPS) {
      expect(ARABIC.test(ar.steps[s.id]!.body)).toBe(true);
      expect(ARABIC.test(en.steps[s.id]!.body)).toBe(false);
    }
    for (const k of ['take', 'replay', 'next', 'back', 'finish', 'skip', 'close'] as const) {
      expect(ARABIC.test(ar[k])).toBe(true);
      expect(ARABIC.test(en[k])).toBe(false);
    }
  });
  it('counts steps in both languages', () => {
    expect(en.stepOf(2, 7)).toBe('Step 2 of 7');
    expect(ar.stepOf(2, 7)).toContain('2');
    expect(ar.stepOf(2, 7)).toContain('7');
  });
  it('says honestly that Arabic is a draft and most screens are English; English needs neither note', () => {
    expect(ar.draftNote).toBeTruthy();
    expect(ar.screenNote).toBeTruthy();
    expect(en.draftNote).toBeNull();
    expect(en.screenNote).toBeNull();
  });
});
