import { describe, expect, it } from 'vitest';
import { isTabbable, nextTrapIndex } from './modalFocus';

describe('modal focus helpers', () => {
  it('skips disabled, hidden and negative-tabindex elements', () => {
    expect(isTabbable({ tabIndex: 0 })).toBe(true);
    expect(isTabbable({ tabIndex: 0, disabled: true })).toBe(false);
    expect(isTabbable({ tabIndex: 0, hidden: true })).toBe(false);
    expect(isTabbable({ tabIndex: 0, type: 'hidden' })).toBe(false);
    expect(isTabbable({ tabIndex: -1 })).toBe(false);
  });

  it('wraps Tab from the last item to the first', () => {
    expect(nextTrapIndex(3, 2, false)).toBe(0);
  });

  it('wraps Shift+Tab from the first item to the last', () => {
    expect(nextTrapIndex(3, 0, true)).toBe(2);
  });

  it('lets the browser move focus inside the list', () => {
    expect(nextTrapIndex(3, 1, false)).toBeNull();
    expect(nextTrapIndex(3, 1, true)).toBeNull();
  });

  it('brings focus back in when it is on the dialog itself', () => {
    expect(nextTrapIndex(3, -1, false)).toBe(0);
    expect(nextTrapIndex(3, -1, true)).toBe(2);
  });

  it('keeps focus on the dialog when nothing inside is tabbable', () => {
    expect(nextTrapIndex(0, -1, false)).toBe(-1);
  });
});
