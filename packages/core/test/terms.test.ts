import { describe, expect, it } from 'vitest';
import { MOROCCO_PRESETS } from '../src/presets';
import { MAX_TERM_LENGTH, MAX_TERMS, joinTerms, searchTerms, termsLabel } from '../src/terms';
import { WATCHLIST_TYPES } from '../src/discovery';

describe('searchTerms', () => {
  it('splits on Latin and Arabic commas and new lines, trims and de-duplicates', () => {
    expect(searchTerms(' maroc ,Livraison  gratuite،الدفع عند الاستلام\nMAROC,, ', 'keyword')).toEqual(['maroc', 'Livraison gratuite', 'الدفع عند الاستلام']);
  });

  it('drops hashtag and account prefixes and keeps at most ten terms', () => {
    expect(searchTerms('#tiktokmaroc, ##maroc', 'hashtag')).toEqual(['tiktokmaroc', 'maroc']);
    expect(searchTerms('@jumia_ma', 'account')).toEqual(['jumia_ma']);
    expect(searchTerms(Array.from({ length: 14 }, (_, i) => `t${i}`).join(','), 'keyword')).toHaveLength(MAX_TERMS);
  });

  it('labels and joins terms', () => {
    expect(termsLabel(['a', 'b', 'c', 'd'])).toBe('a, b +2');
    expect(termsLabel(['a'])).toBe('a');
    expect(joinTerms(['a', 'b'])).toBe('a, b');
  });
});

describe('MOROCCO_PRESETS', () => {
  it('are valid boards: allowed type, unique ids, terms within limits', () => {
    expect(new Set(MOROCCO_PRESETS.map((p) => p.id)).size).toBe(MOROCCO_PRESETS.length);
    for (const p of MOROCCO_PRESETS) {
      expect(WATCHLIST_TYPES[p.source]).toContain(p.type);
      if (p.type === 'snowball') continue;
      const terms = searchTerms(p.value, p.type);
      expect(terms.length).toBeGreaterThan(0);
      expect(terms.length).toBeLessThanOrEqual(MAX_TERMS);
      expect(joinTerms(terms)).toBe(p.value);
      for (const t of terms) expect(t.length).toBeLessThanOrEqual(MAX_TERM_LENGTH);
    }
  });
});
