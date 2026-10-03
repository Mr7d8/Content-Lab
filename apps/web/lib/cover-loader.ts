// Covers load once per page, a few at a time, in the order they are asked
// for (the map asks best ranked first). The Top ads list shows its covers
// itself and reports them here, so the map only flies a cover in once its
// image is in, and never fetches one the list already has.

type Fetch = (url: string, done: () => void) => void;

export type CoverLoader = {
  // Resolves once the image has loaded, failed (it then shows its gradient),
  // or taken too long; it never rejects, so a bad link cannot hold the map.
  load: (url: string) => Promise<void>;
  // A cover the page already showed counts as loaded.
  loaded: (url: string) => void;
};

export function createCoverLoader(fetch: Fetch, { maxAtOnce = 8, timeoutMs = 8000 } = {}): CoverLoader {
  const entries = new Map<string, { promise: Promise<void>; resolve: () => void; done: boolean; queued: boolean }>();
  const queue: string[] = [];
  let running = 0;

  const entry = (url: string) => {
    let e = entries.get(url);
    if (!e) {
      let resolve = () => {};
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      e = { promise, resolve, done: false, queued: false };
      entries.set(url, e);
    }
    return e;
  };

  const finish = (url: string) => {
    const e = entry(url);
    if (e.done) return;
    e.done = true;
    e.resolve();
  };

  const pump = () => {
    while (running < maxAtOnce && queue.length) {
      const url = queue.shift() as string;
      if (entry(url).done) continue;
      running++;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        running--;
        finish(url);
        pump();
      };
      const timer = setTimeout(done, timeoutMs);
      fetch(url, done);
    }
  };

  return {
    load(url) {
      const e = entry(url);
      if (!e.done && !e.queued) {
        e.queued = true;
        queue.push(url);
        pump();
      }
      return e.promise;
    },
    loaded: finish,
  };
}

// The page's loader. An Image with the same settings as the <img> in Cover,
// so the browser serves the cover from its cache when it is shown.
export const covers = createCoverLoader((url, done) => {
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.onload = done;
  img.onerror = done;
  img.src = url;
});
