import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES, estimateRun, fitsUnderCap, formatUsd, itemCost, suggestCap } from '../src/cost';
import { expandRegion, sourceLabel } from '../src/sources';

describe('cost', () => {
  it('counts free tiers as zero and Jev by tokens', () => {
    const c = itemCost(DEFAULT_RATES);
    expect(c.groq).toBe(0);
    expect(c.vision).toBe(0);
    expect(c.jev).toBeCloseTo(0.000378, 6);
  });

  it('estimates a run', () => {
    const e = estimateRun(100);
    expect(e.total).toBeCloseTo(100 * (0.005 + 0.002 + 0.000378), 6);
    expect(e.lines.apify).toBeCloseTo(0.5, 6);
  });

  it('suggests a cap with headroom', () => {
    expect(suggestCap(0.1)).toBe(0.5);
    expect(suggestCap(1.2)).toBe(2);
  });

  it('enforces the cap before an item starts', () => {
    expect(fitsUnderCap(0.99, 0.01, 1)).toBe(true);
    expect(fitsUnderCap(0.995, 0.01, 1)).toBe(false);
  });

  it('formats small amounts', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.0004)).toBe('$0.0004');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});

describe('sources', () => {
  it('expands region groups', () => {
    expect(expandRegion('MENA')).toContain('MA');
    expect(expandRegion('FR')).toEqual(['FR']);
    expect(expandRegion(null)).toBeNull();
    expect(sourceLabel('tiktok_creative_center')).toBe('Creative Center');
  });
});
