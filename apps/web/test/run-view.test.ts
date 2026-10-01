import { describe, expect, it } from 'vitest';
import { bandDomain, buildTimeline, objectiveColor, primaryMetric, replayState, type RunViewItem, withPercentiles } from '../lib/run-view';

const item = (id: string, patch: Partial<RunViewItem> = {}): RunViewItem => ({
  id, position: Number(id.replace(/\D/g, '')) || 0, source: 'tiktok_organic', advertiser: null, status: 'done', stage: 'done',
  thumb: 'x', labels: null, metric: null, percentile: null, times: { collected: 0, framed: null, classified: null }, ...patch,
});

describe('primaryMetric', () => {
  it('uses the source-specific signal and never mixes sources', () => {
    expect(primaryMetric('tiktok_organic', [{ name: 'likes', value: 5 }, { name: 'views', value: 900 }])).toEqual({ name: 'views', value: 900 });
    expect(primaryMetric('tiktok_creative_center', [{ name: 'likes', value: 5 }, { name: 'ctr', value: 0.02 }])).toEqual({ name: 'ctr', value: 0.02 });
    expect(primaryMetric('tiktok_organic', [{ name: 'views', value: null }])).toBeNull();
  });
});

describe('withPercentiles', () => {
  it('ranks within each source and metric, with ties sharing a rank', () => {
    const items = withPercentiles([
      item('a1', { metric: { name: 'views', value: 10 } }),
      item('a2', { metric: { name: 'views', value: 30 } }),
      item('a3', { metric: { name: 'views', value: 30 } }),
      item('a4', { metric: { name: 'views', value: 50 } }),
      item('c1', { source: 'tiktok_creative_center', metric: { name: 'ctr', value: 0.1 } }),
      item('c2', { source: 'tiktok_creative_center', metric: { name: 'ctr', value: 0.2 } }),
    ]);
    expect(items.map((i) => i.percentile)).toEqual([0, 50, 50, 100, null, null]);
  });

  it('keeps scores that already exist', () => {
    const items = withPercentiles([item('a1', { percentile: 88, metric: { name: 'views', value: 1 } })]);
    expect(items[0]?.percentile).toBe(88);
  });
});

describe('replay timeline', () => {
  it('scales saved timestamps onto a fixed length in order', () => {
    const items = [
      item('i1', { times: { collected: 0, framed: 10_000, classified: 40_000 }, labels: {} as never }),
      item('i2', { times: { collected: 0, framed: 20_000, classified: 50_000 }, labels: {} as never }),
    ];
    const events = buildTimeline(items, 30000);
    expect(events.map((e) => `${e.itemId}:${e.kind}`)).toEqual(['i1:thumb', 'i2:thumb', 'i1:labels', 'i2:labels']);
    expect(events[0]!.at).toBeLessThan(events[3]!.at);
    expect(events.at(-1)!.at).toBe(30000);
    const mid = replayState(events, events[1]!.at);
    expect([...mid.thumbs]).toEqual(['i1', 'i2']);
    expect(mid.labels.size).toBe(0);
  });

  it('spreads events evenly when timestamps are identical', () => {
    const events = buildTimeline([item('i1', { labels: {} as never }), item('i2', { labels: {} as never })], 1000);
    expect(events.map((e) => e.at)).toEqual([250, 500, 750, 1000]);
  });
});

describe('map helpers', () => {
  it('orders band values by taxonomy with Unknown last', () => {
    expect(bandDomain(['purchase', null, 'app_install'], 'objective')).toEqual(['app_install', 'purchase', 'unknown']);
  });

  it('uses three colour slots at most', () => {
    expect(new Set([objectiveColor('app_install'), objectiveColor('purchase'), objectiveColor('brand'), objectiveColor(null)]).size).toBe(3);
  });
});
