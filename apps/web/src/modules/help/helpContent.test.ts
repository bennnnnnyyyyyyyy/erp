import { describe, expect, it } from 'vitest';
import { guideContent, parseRich, tutorialContent, type StepText } from './helpContent';

// The tutorial and the Guide are written in two languages. These tests keep them in step: a step added in English but forgotten in
// Arabic (or the reverse) fails here instead of showing a gap to a customer.

const ARABIC_LETTERS = /[؀-ۿ]/;
const bold = (s: string) => parseRich(s).filter((r) => r.bold).length;

describe('tutorial content', () => {
  const en = tutorialContent('en');
  const ar = tutorialContent('ar');

  it('has the same structure in both languages', () => {
    expect(ar.steps.length).toBe(en.steps.length);
    expect(ar.checklist.length).toBe(en.checklist.length);
    expect(ar.notReady.length).toBe(en.notReady.length);
    expect(en.steps.length).toBe(9);
    expect(en.checklist.length).toBe(7);
  });
  it('has no empty text', () => {
    for (const c of [en, ar]) {
      const all = [c.title, c.yourSetup, c.progressLabel, c.srDone, c.srNotAvailable, c.srNotDone, c.notReadyTitle, c.hide, c.hideHintCan, c.hideHintCannot, ...c.checklist, ...c.notReady, ...c.steps.flatMap((s: StepText) => [s.title, s.toLabel, s.body])];
      for (const s of all) expect(s.trim().length).toBeGreaterThan(0);
    }
  });
  it('Arabic is Arabic, English is not', () => {
    for (const s of [ar.title, ar.yourSetup, ...ar.checklist, ...ar.steps.map((x) => x.title), ...ar.steps.map((x) => x.body)]) expect(ARABIC_LETTERS.test(s)).toBe(true);
    for (const s of [en.title, en.yourSetup, ...en.checklist, ...en.steps.map((x) => x.title)]) expect(ARABIC_LETTERS.test(s)).toBe(false);
  });
  it('highlights the same number of things in each step', () => {
    en.steps.forEach((s, i) => expect(bold(ar.steps[i]!.body)).toBe(bold(s.body)));
    en.notReady.forEach((s, i) => expect(bold(ar.notReady[i]!)).toBe(bold(s)));
  });
  it('keeps the numbers and cross-references identical (step 4 and step 8 are referred to by number)', () => {
    const digits = (s: string) => (s.match(/\d+/g) ?? []).join(',');
    en.steps.forEach((s, i) => expect(digits(ar.steps[i]!.body)).toBe(digits(s.body)));
  });
  it('the Arabic draft says it is a draft; the English does not need to', () => {
    expect(ar.draftNote).toBeTruthy();
    expect(en.draftNote).toBeNull();
  });
  it('formats counts and names in both languages', () => {
    expect(en.doneOf(3, 7)).toBe('3 of 7 done');
    expect(ar.doneOf(3, 7)).toContain('3');
    expect(ar.doneOf(3, 7)).toContain('7');
    expect(en.intro('Acme')).toContain('Acme');
    expect(ar.intro('Acme')).toContain('Acme');
  });
});

describe('guide content', () => {
  const en = guideContent('en');
  const ar = guideContent('ar');

  it('has the same structure in both languages', () => {
    expect(ar.steps.length).toBe(en.steps.length);
    expect(ar.notReady.length).toBe(en.notReady.length);
    expect(en.steps.length).toBe(5);
    expect(en.notReady.length).toBe(6);
  });
  it('has no empty text and Arabic is Arabic', () => {
    for (const c of [en, ar]) {
      for (const s of [c.title, c.intro, c.whereTitle, c.whereHint, c.fiveTitle, c.fiveHint, c.notReadyTitle, c.notReadyHint, ...c.notReady, ...c.steps.flatMap((x) => [x.title, x.toLabel, x.body])]) {
        expect(s.trim().length).toBeGreaterThan(0);
      }
    }
    for (const s of [ar.title, ar.intro, ...ar.steps.map((x) => x.body), ...ar.notReady]) expect(ARABIC_LETTERS.test(s)).toBe(true);
    expect(ar.draftNote).toBeTruthy();
  });
  it('highlights the same number of things in each item', () => {
    en.notReady.forEach((s, i) => expect(bold(ar.notReady[i]!)).toBe(bold(s)));
  });
});

describe('bold markers', () => {
  it('splits text into plain and bold runs', () => {
    expect(parseRich('a **b** c')).toEqual([{ text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false }]);
    expect(parseRich('**only**')).toEqual([{ text: 'only', bold: true }]);
    expect(parseRich('plain')).toEqual([{ text: 'plain', bold: false }]);
  });
  it('keeps an unbalanced marker as plain text instead of dropping words or throwing', () => {
    expect(parseRich('a **b c')).toEqual([{ text: 'a **b c', bold: false }]);
  });
  it('never produces markup: angle brackets stay as text', () => {
    expect(parseRich('<script>**x**</script>')).toEqual([{ text: '<script>', bold: false }, { text: 'x', bold: true }, { text: '</script>', bold: false }]);
  });
});
