import { describe, expect, it } from 'vitest';
import { matchesSearch, normalizeSearch } from './SearchSelect';

describe('search matching', () => {
  const delta = { value: 'c1', label: 'C-00012 · Delta Trading', keywords: '+20 100 123 4567 Cairo' };

  it('matches every typed word, in any order, against label and keywords', () => {
    expect(matchesSearch(delta, 'delta')).toBe(true);
    expect(matchesSearch(delta, 'trading delta')).toBe(true);
    expect(matchesSearch(delta, 'c-00012')).toBe(true);
    expect(matchesSearch(delta, 'cairo')).toBe(true);
    expect(matchesSearch(delta, 'delta alex')).toBe(false);
  });

  it('matches Arabic with or without hamza, diacritics or taa marbuta', () => {
    const ahmed = { value: 'c2', label: 'شركة أحمد للتجارة' };
    expect(matchesSearch(ahmed, 'احمد')).toBe(true);
    expect(matchesSearch(ahmed, 'شركه')).toBe(true);
    expect(normalizeSearch('مُحَمَّد')).toBe(normalizeSearch('محمد'));
  });

  it('shows everything for an empty query', () => {
    expect(matchesSearch(delta, '   ')).toBe(true);
  });
});
