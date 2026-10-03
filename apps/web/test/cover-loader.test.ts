import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoverLoader } from '../lib/cover-loader';

// A fake fetch: records each request and finishes it when told to.
function fakeFetch() {
  const requests: string[] = [];
  const pending = new Map<string, () => void>();
  const fetch = (url: string, done: () => void) => {
    requests.push(url);
    pending.set(url, done);
  };
  const finish = (url: string) => pending.get(url)?.();
  return { fetch, requests, finish };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('cover loader', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('loads a few at a time, in the order asked, each once', async () => {
    const f = fakeFetch();
    const loader = createCoverLoader(f.fetch, { maxAtOnce: 2 });
    const order: string[] = [];
    for (const url of ['a', 'b', 'c', 'a']) void loader.load(url).then(() => order.push(url));
    expect(f.requests).toEqual(['a', 'b']);
    f.finish('b');
    expect(f.requests).toEqual(['a', 'b', 'c']);
    f.finish('a');
    f.finish('c');
    vi.useRealTimers();
    await flush();
    // The second ask for a shares the first one's load.
    expect(order).toEqual(['b', 'a', 'a', 'c']);
  });

  it('takes a cover the page already showed as loaded, without fetching it', async () => {
    const f = fakeFetch();
    const loader = createCoverLoader(f.fetch, { maxAtOnce: 1 });
    let ready = false;
    void loader.load('a');
    void loader.load('b').then(() => {
      ready = true;
    });
    loader.loaded('b');
    vi.useRealTimers();
    await flush();
    expect(ready).toBe(true);
    f.finish('a');
    expect(f.requests).toEqual(['a']);
  });

  it('lets a cover go after the timeout, and moves on to the next', async () => {
    const f = fakeFetch();
    const loader = createCoverLoader(f.fetch, { maxAtOnce: 1, timeoutMs: 100 });
    let ready = false;
    void loader.load('slow').then(() => {
      ready = true;
    });
    void loader.load('next');
    vi.advanceTimersByTime(100);
    expect(f.requests).toEqual(['slow', 'next']);
    vi.useRealTimers();
    await flush();
    expect(ready).toBe(true);
  });
});
